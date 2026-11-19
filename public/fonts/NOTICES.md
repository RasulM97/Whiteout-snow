# Bundled fonts

Gameplay loads these files from this folder. It does not request a font CDN.

| File | Source | License |
| --- | --- | --- |
| InterVariable.woff2 | Inter 4.1, `web/InterVariable.woff2` inside https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip (33,707,794 bytes) | Inter-LICENSE.txt (SIL Open Font License 1.1) |
| Vazirmatn.woff2 | Vazirmatn 33.003 variable, `fonts/webfonts/Vazirmatn[wght].woff2` inside https://github.com/rastikerdar/vazirmatn/releases/download/v33.003/vazirmatn-v33.003.zip (13,047,191 bytes) | Vazirmatn-OFL.txt |
| NotoSansSC.woff2 | Subset of the variable font https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf (17,772,300 bytes). The subset keeps the weight axis and the Simplified Chinese characters used by this game, plus ASCII. | NotoSansSC-OFL.txt |

Roles: Inter for English titles, headings, body, HUD, buttons and numbers. Vazirmatn for Persian. Noto Sans SC for Simplified Chinese, with Inter as the Latin fallback. Shortcut keys stay on the interface monospace and stay left to right.
