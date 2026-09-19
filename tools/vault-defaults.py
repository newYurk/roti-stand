#!/usr/bin/env python3
"""Исходные настройки хранилища Roti-Obsidian — ставятся, ТОЛЬКО если файла ещё нет.

⚑ Зачем отдельный скрипт (18.09). Настройки Obsidian в git не идут: он переписывает
graph.json от каждого движения колёсика, а workspace.json — от каждой вкладки, и рабочая
копия из-за этого никогда не бывает чистой. В этой ветке такое уже случалось: пять коммитов
подряд — «Carry the owner\'s graph view zoom», затем дважды «Restore the graph colour groups»,
потому что закоммиченный зум сносил раскраску.

У двух других игр то же делает их генератор хранилища. Здесь генератора нет — заметки
пишутся руками, — поэтому семя лежит тут.

Запуск:  python3 tools/vault-defaults.py
Ничего не перезаписывает: что владелица подкрутила у себя, остаётся как есть.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT = os.path.join(ROOT, "Roti-Obsidian", ".obsidian")

# Настройки лежат строкой JSON, а не литералом Python: у JSON свои true/false/null.
DEFAULTS_JSON = r"""{
 "app.json": {
  "promptDelete": false,
  "attachmentFolderPath": "Рисунки"
 },
 "appearance.json": {
  "theme": "system"
 },
 "core-plugins.json": {
  "file-explorer": true,
  "global-search": true,
  "switcher": true,
  "graph": true,
  "backlink": true,
  "canvas": true,
  "outgoing-link": true,
  "tag-pane": true,
  "footnotes": false,
  "properties": true,
  "page-preview": true,
  "daily-notes": true,
  "templates": true,
  "note-composer": true,
  "command-palette": true,
  "slash-command": false,
  "editor-status": true,
  "bookmarks": true,
  "markdown-importer": false,
  "zk-prefixer": false,
  "random-note": false,
  "outline": true,
  "word-count": true,
  "slides": false,
  "audio-recorder": false,
  "workspaces": false,
  "file-recovery": true,
  "publish": false,
  "sync": true,
  "bases": true,
  "webviewer": false
 },
 "community-plugins.json": [
  "obsidian-excalidraw-plugin",
  "breadcrumbs"
 ],
 "graph.json": {
  "collapse-filter": false,
  "search": "-file:\"00 Карта историй\"",
  "showTags": false,
  "showAttachments": false,
  "hideUnresolved": true,
  "showOrphans": true,
  "collapse-color-groups": false,
  "colorGroups": [
   {
    "query": "path:\"01 Люди\"",
    "color": {
     "a": 1,
     "rgb": 15245898
    }
   },
   {
    "query": "path:\"02 Мир\"",
    "color": {
     "a": 1,
     "rgb": 6000552
    }
   },
   {
    "query": "path:\"03 Тайны\"",
    "color": {
     "a": 1,
     "rgb": 10190773
    }
   },
   {
    "query": "path:\"04 Дизайн\"",
    "color": {
     "a": 1,
     "rgb": 8366207
    }
   },
   {
    "query": "path:\"05 Тележка\"",
    "color": {
     "a": 1,
     "rgb": 11569512
    }
   }
  ],
  "collapse-display": true,
  "showArrow": true,
  "textFadeMultiplier": -3,
  "nodeSizeMultiplier": 1.2,
  "lineSizeMultiplier": 0.7,
  "collapse-forces": true,
  "centerStrength": 0.15,
  "repelStrength": 15,
  "linkStrength": 0.4,
  "linkDistance": 420,
  "scale": 1.5381034046870778,
  "close": false
 },
 "bookmarks.json": {
  "items": [
   {
    "type": "group",
    "ctime": 1789774569527,
    "title": "Виды графа",
    "items": [
     {
      "type": "graph",
      "ctime": 1789774569527,
      "title": "Люди и тайны",
      "options": {
       "collapse-filter": false,
       "search": "path:\"01 Люди\" OR path:\"03 Тайны\"",
       "showTags": false,
       "showAttachments": false,
       "hideUnresolved": true,
       "showOrphans": true,
       "collapse-color-groups": false,
       "colorGroups": [
        {
         "query": "path:\"01 Люди\"",
         "color": {
          "a": 1,
          "rgb": 15245898
         }
        },
        {
         "query": "path:\"02 Мир\"",
         "color": {
          "a": 1,
          "rgb": 6000552
         }
        },
        {
         "query": "path:\"03 Тайны\"",
         "color": {
          "a": 1,
          "rgb": 10190773
         }
        },
        {
         "query": "path:\"04 Дизайн\"",
         "color": {
          "a": 1,
          "rgb": 8366207
         }
        },
        {
         "query": "path:\"05 Тележка\"",
         "color": {
          "a": 1,
          "rgb": 11569512
         }
        }
       ],
       "collapse-display": true,
       "showArrow": true,
       "textFadeMultiplier": -3,
       "nodeSizeMultiplier": 1.2,
       "lineSizeMultiplier": 0.7,
       "collapse-forces": true,
       "centerStrength": 0.15,
       "repelStrength": 15,
       "linkStrength": 0.4,
       "linkDistance": 420,
       "scale": 1.5381034046870778,
       "close": false
      }
     },
     {
      "type": "graph",
      "ctime": 1789774569528,
      "title": "Без черновиков",
      "options": {
       "collapse-filter": false,
       "search": "-file:\"черновик\" -file:\"00 Карта историй\"",
       "showTags": false,
       "showAttachments": false,
       "hideUnresolved": true,
       "showOrphans": true,
       "collapse-color-groups": false,
       "colorGroups": [
        {
         "query": "path:\"01 Люди\"",
         "color": {
          "a": 1,
          "rgb": 15245898
         }
        },
        {
         "query": "path:\"02 Мир\"",
         "color": {
          "a": 1,
          "rgb": 6000552
         }
        },
        {
         "query": "path:\"03 Тайны\"",
         "color": {
          "a": 1,
          "rgb": 10190773
         }
        },
        {
         "query": "path:\"04 Дизайн\"",
         "color": {
          "a": 1,
          "rgb": 8366207
         }
        },
        {
         "query": "path:\"05 Тележка\"",
         "color": {
          "a": 1,
          "rgb": 11569512
         }
        }
       ],
       "collapse-display": true,
       "showArrow": true,
       "textFadeMultiplier": -3,
       "nodeSizeMultiplier": 1.2,
       "lineSizeMultiplier": 0.7,
       "collapse-forces": true,
       "centerStrength": 0.15,
       "repelStrength": 15,
       "linkStrength": 0.4,
       "linkDistance": 420,
       "scale": 1.5381034046870778,
       "close": false
      }
     },
     {
      "type": "graph",
      "ctime": 1789774569529,
      "title": "Всё как было",
      "options": {
       "collapse-filter": false,
       "search": "",
       "showTags": false,
       "showAttachments": false,
       "hideUnresolved": true,
       "showOrphans": true,
       "collapse-color-groups": false,
       "colorGroups": [
        {
         "query": "path:\"01 Люди\"",
         "color": {
          "a": 1,
          "rgb": 15245898
         }
        },
        {
         "query": "path:\"02 Мир\"",
         "color": {
          "a": 1,
          "rgb": 6000552
         }
        },
        {
         "query": "path:\"03 Тайны\"",
         "color": {
          "a": 1,
          "rgb": 10190773
         }
        },
        {
         "query": "path:\"04 Дизайн\"",
         "color": {
          "a": 1,
          "rgb": 8366207
         }
        },
        {
         "query": "path:\"05 Тележка\"",
         "color": {
          "a": 1,
          "rgb": 11569512
         }
        }
       ],
       "collapse-display": true,
       "showArrow": true,
       "textFadeMultiplier": -3,
       "nodeSizeMultiplier": 1.2,
       "lineSizeMultiplier": 0.7,
       "collapse-forces": true,
       "centerStrength": 0.15,
       "repelStrength": 15,
       "linkStrength": 0.4,
       "linkDistance": 420,
       "scale": 1.5381034046870778,
       "close": false
      }
     }
    ]
   }
  ]
 }
}"""


def main():
    os.makedirs(VAULT, exist_ok=True)
    поставлено = []
    for имя, содержимое in json.loads(DEFAULTS_JSON).items():
        путь = os.path.join(VAULT, имя)
        if os.path.exists(путь):
            continue
        with open(путь, "w", encoding="utf-8") as f:
            json.dump(содержимое, f, ensure_ascii=False, indent=2)
            f.write("\n")
        поставлено.append(имя)
    print("поставлено: " + (", ".join(поставлено) if поставлено else "ничего, всё уже на месте"))


if __name__ == "__main__":
    main()
