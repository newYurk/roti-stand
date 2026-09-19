#!/usr/bin/env python3
"""Regression checks for the vault's relation semantics (standard library only).

Run: python3 tools/test-vault-graphs.py
Mermaid syntax/rendering is a separate check; this suite checks meaning and links.
"""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Roti-Obsidian"
MECHANICS = VAULT / "06 Механики"
OVERVIEW = VAULT / "00 Карта историй.md"
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
        for path in paths:
            for link in re.findall(r"\[\[([^\]]+)\]\]", read(path)):
                target = link.split("|", 1)[0].split("#", 1)[0]
                if not target:
                    continue
                # Attachments are not notes and are outside this relation check.
                if Path(target).suffix and not target.endswith(".md"):
                    continue
                if target.endswith(".md"):
                    target = target[:-3]
                with self.subTest(file=path.name, target=target):
                    self.assertTrue(target in names or target in relative)


if __name__ == "__main__":
    unittest.main(verbosity=2)
