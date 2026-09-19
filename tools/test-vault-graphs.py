#!/usr/bin/env python3
"""Regression checks for the vault's relation semantics (standard library only).

Run: python3 tools/test-vault-graphs.py
Mermaid syntax/rendering is a separate check; this suite checks meaning and links.
"""
from pathlib import Path
import re
import unittest
import json


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Roti-Obsidian"
MECHANICS = VAULT / "06 Механики"
OVERVIEW = VAULT / "04 Дизайн" / "Связи механик.md"
HOME = VAULT / "00 Карта историй.md"
VIEWS = VAULT / "07 Виды"
VIEW_NAMES = ("Мир", "Игровая петля", "Зависимости", "Решения и риски")
IMPACT = VAULT / "04 Дизайн" / "На чём это стоит.md"

# These are the relations represented in the overview, not every possible input.
EXPECTED = {
    "Лист на столе": {"материал-из": ["Тесто — предел дня"]},
    "Жарка на таве": {
        "материал-из": ["Лист на столе"],
        "расширения-из": ["Тележка — музей отношений"],
    },
    "Встреча и обмен": {
        "блюдо-из": ["Жарка на таве"],
        "контекст-из": ["Карта точек"],
    },
    "Каталог и обещания": {"записи-из": ["Встреча и обмен"]},
    "Тележка — музей отношений": {"предметы-из": ["Встреча и обмен"]},
    "Петля дня": {
        "лимит-из": ["Тесто — предел дня"],
        "выбор-точки-через": ["Карта точек"],
        "память-в": ["Каталог и обещания"],
    },
}


def read(path):
    return path.read_text(encoding="utf-8")


def relations(text):
    """Read only our deliberately small YAML subset: lists of quoted wikilinks."""
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    if not match:
        return {}
    result = {}
    key = None
    for line in match[1].splitlines():
        prop = re.fullmatch(r"([^\s:]+):", line)
        value = re.fullmatch(r'  - "\[\[([^\]]+)\]\]"', line)
        if prop:
            key = prop[1]
            if key in result:
                raise ValueError(f"Duplicate property: {key}")
            result[key] = []
        elif value and key:
            result[key].append(value[1])
        else:
            raise ValueError(f"Unsupported relation property line: {line!r}")
    return result


def diagram(text):
    return re.search(r"```mermaid\n(.*?)```", text, re.S)[1]


def edges(text):
    return re.findall(
        r'^\s*(\w+)\s+(-->|-\.->|==>)\|"([^"]+)"\|\s+(\w+)\s*$',
        diagram(text), re.M,
    )


class VaultGraphTests(unittest.TestCase):
    def test_relation_properties_are_typed_and_quoted(self):
        for name, expected in EXPECTED.items():
            with self.subTest(note=name):
                self.assertEqual(relations(read(MECHANICS / f"{name}.md")), expected)

    def test_no_generic_dependency_property_remains(self):
        for path in MECHANICS.glob("*.md"):
            self.assertNotRegex(read(path), r"(?m)^опирается-на:")

    def test_every_relation_property_has_a_legend(self):
        legend = read(OVERVIEW)
        for prop in {p for props in EXPECTED.values() for p in props}:
            self.assertIn(f"| `{prop}` |", legend)

    def test_second_burner_is_not_required_for_basic_frying(self):
        graph = edges(read(OVERVIEW))
        self.assertIn(("CART", "-.->",
                       "необязательное расширение: вторая горелка", "PAR"), graph)
        self.assertIn(("PAN", "==>", "необходимо: базовая жарка", "PAR"), graph)
        self.assertFalse(any(a == "CART" and b == "PAN" for a, _, _, b in graph))

    def test_mandatory_edges_are_acyclic(self):
        adjacency = {}
        for a, arrow, label, b in edges(read(OVERVIEW)):
            if arrow == "==>":
                self.assertTrue(label.startswith("необходимо:"))
                adjacency.setdefault(a, []).append(b)
        visiting, visited = set(), set()

        def visit(node):
            self.assertNotIn(node, visiting, f"Mandatory dependency cycle: {node}")
            if node in visited:
                return
            visiting.add(node)
            for other in adjacency.get(node, []):
                visit(other)
            visiting.remove(node)
            visited.add(node)

        for node in adjacency:
            visit(node)

    def test_overview_edges_are_labelled_and_end_at_declared_nodes(self):
        for path in (OVERVIEW, IMPACT):
            graph = diagram(read(path))
            nodes = set(re.findall(r'^\s*(\w+)\["', graph, re.M))
            graph_edges = edges(read(path))
            edge_lines = re.findall(r"(?m)^.*(?:-->|-\.->|==>).*$", graph)
            self.assertEqual(len(graph_edges), len(edge_lines), path.name)
            for a, _, label, b in graph_edges:
                with self.subTest(file=path.name, source=a, target=b):
                    self.assertIn(a, nodes)
                    self.assertIn(b, nodes)
                    self.assertTrue(label.strip())

    def test_debts_are_not_statuses_of_characters(self):
        graph = diagram(read(IMPACT))
        classes = dict(re.findall(r'^\s*(\w+)\["[^"]+"\]:::(\w+)', graph, re.M))
        self.assertEqual(classes["КОТ"], "заметка")
        self.assertEqual(classes["ЛЕЖАНКА"], "долг")
        self.assertEqual(classes["ГИРЛЯНДА"], "долг")
        self.assertIn("Вопрос мира: тесто", graph)
        self.assertIn("Вопрос объёма v1", graph)

    def test_accepted_decisions_keep_note_links(self):
        text = read(IMPACT)
        section = text.split("## Принятые решения: связи сохранены", 1)[1]
        section = section.split("### Как обновлять карту", 1)[0]
        rows = [line for line in section.splitlines() if line.startswith("| §")]
        self.assertEqual(len(rows), 7)
        for row in rows:
            self.assertRegex(row, r"\[\[[^\]]+\]\]")
        self.assertNotIn("закрылся вопрос — убрать стрелку", text)

    def test_internal_links_resolve_in_vault(self):
        paths = list(VAULT.rglob("*.md"))
        names = {p.stem for p in paths}
        relative = {str(p.relative_to(VAULT).with_suffix("")) for p in paths}
        texts = [(p, read(p)) for p in paths]
        for path in VIEWS.glob("*.canvas"):
            data = json.loads(read(path))
            texts.extend((path, n["text"]) for n in data["nodes"] if n["type"] == "text")
        for path, text in texts:
            for link in re.findall(r"\[\[([^\]]+)\]\]", text):
                target = link.split("|", 1)[0].split("#", 1)[0]
                if not target:
                    continue
                if target.endswith(".canvas"):
                    self.assertTrue((VAULT / target).is_file(), target)
                    continue
                # Attachments are not notes and are outside this relation check.
                if Path(target).suffix and not target.endswith(".md"):
                    continue
                if target.endswith(".md"):
                    target = target[:-3]
                with self.subTest(file=path.name, target=target):
                    self.assertTrue(target in names or target in relative)

    def test_home_is_short_and_opens_four_views(self):
        text = read(HOME)
        self.assertLessEqual(len(text.splitlines()), 25)
        self.assertNotIn("```mermaid", text)
        self.assertNotIn("|---", text)
        for name in VIEW_NAMES:
            self.assertIn(f"07 Виды/{name}.canvas|", text)
        self.assertIn("можно менять", text)

    def test_canvas_schema_and_targets(self):
        for name in VIEW_NAMES:
            with self.subTest(view=name):
                data = json.loads(read(VIEWS / f"{name}.canvas"))
                ids = [n["id"] for n in data["nodes"]]
                self.assertEqual(len(ids), len(set(ids)))
                self.assertLessEqual(len(ids), 10)
                edge_ids = [e["id"] for e in data["edges"]]
                self.assertEqual(len(edge_ids), len(set(edge_ids)))
                for node in data["nodes"]:
                    self.assertEqual(node["type"], "text")
                    self.assertIn("[[", node["text"])
                    for field in ("x", "y", "width", "height"):
                        self.assertIsInstance(node[field], int)
                    self.assertGreaterEqual(node["width"], 250)
                    self.assertGreaterEqual(node["height"], 130)
                for edge in data["edges"]:
                    self.assertIn(edge["fromNode"], ids)
                    self.assertIn(edge["toNode"], ids)
                    self.assertTrue(edge["label"])
                    for field in ("fromSide", "toSide"):
                        self.assertIn(edge[field], ("left", "right", "top", "bottom"))
                    for field in ("fromEnd", "toEnd"):
                        self.assertIn(edge[field], ("none", "arrow"))

    def test_canvas_cards_do_not_overlap(self):
        for path in VIEWS.glob("*.canvas"):
            nodes = json.loads(read(path))["nodes"]
            for i, a in enumerate(nodes):
                for b in nodes[i+1:]:
                    overlap = (a["x"] < b["x"]+b["width"] and
                               b["x"] < a["x"]+a["width"] and
                               a["y"] < b["y"]+b["height"] and
                               b["y"] < a["y"]+a["height"])
                    self.assertFalse(overlap, f"{path.name}: {a['id']} / {b['id']}")

    def test_canvas_dependency_does_not_block_base_frying(self):
        data = json.loads(read(VIEWS / "Зависимости.canvas"))
        pairs = {(e["fromNode"], e["toNode"]) for e in data["edges"]}
        self.assertNotIn(("burner", "frying"), pairs)
        self.assertIn(("burner", "extension"), pairs)
        self.assertIn(("frying", "extension"), pairs)

    def test_world_relationships_are_not_prerequisite_arrows(self):
        data = json.loads(read(VIEWS / "Мир.canvas"))
        relations = {e["id"]: e for e in data["edges"]}
        self.assertEqual(relations["friends"]["toEnd"], "none")
        self.assertEqual(relations["shared-past"]["toEnd"], "none")

    def test_day_loop_has_continue_and_close_branches(self):
        data = json.loads(read(VIEWS / "Игровая петля.canvas"))
        relations = {e["id"]: e for e in data["edges"]}
        self.assertEqual(relations["more-roti"]["toNode"], "point")
        self.assertEqual(relations["memory-close"]["toNode"], "close")
        self.assertEqual(relations["memory-close"]["label"], "нет теста")
        self.assertEqual(relations["repeat"]["fromNode"], "close")

    def test_every_view_has_return_navigation_and_revision_notice(self):
        for path in VIEWS.glob("*.canvas"):
            data = json.loads(read(path))
            nav = next(n for n in data["nodes"] if n["id"] == "navigation")
            self.assertIn("[[00 Карта историй|Все виды]]", nav["text"])
            self.assertIn("можно менять", nav["text"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
