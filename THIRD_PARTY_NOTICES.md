# Dependências de PDF e tinta

As licenças completas dos bundles estão distribuídas junto dos arquivos locais em
`apps/open_doc/static/js/vendor/`. Não há carregamento por CDN na aplicação.

| Projeto | Versão fixada | Licença | Uso |
| --- | --- | --- | --- |
| Mozilla PDF.js | 4.10.38 | Apache-2.0 | Leitura, texto selecionável e worker local |
| pptx-viewer | 0.2.2 | MIT | Slides SVG/HTML locais, sem LibreOffice |
| fflate | 0.8.3 (lockfile) | MIT | ZIP do renderer PPTX |
| perfect-freehand | 1.2.2 | MIT | Contorno dos traços com pressão |
| core-js | 3.41.0 | MIT | Compatibilidade do bundle com Chromium 83+ |
| esbuild | 0.25.5 | MIT | Build, somente desenvolvimento |
| python-pptx | >=1.0,<2 | MIT | Leitura de metadados e exportação OOXML |
| pypdf | >=5,<7 | BSD-3-Clause | Preservação/mesclagem de PDF |
| Pillow | >=10,<13 | HPND | Rasterização exclusiva das anotações |
| fpdf2 | >=2.8,<3 | LGPL-3.0 | Texto nativo e camada transparente de PDF |
| PyWinRT | 3.2.1 | MIT | Adaptador opcional Windows Ink |
| PaddleOCR | 2.10.0 | Apache-2.0 | Adaptador opcional, modelos locais |
| PaddlePaddle | >=2.6.2,<3 | Apache-2.0 | Runtime opcional do OCR |

Fontes padrão e CMaps de PDF.js incluem seus avisos próprios em
`static/pdfjs/standard_fonts/LICENSE_FOXIT`, `LICENSE_LIBERATION` e
`static/pdfjs/cmaps/LICENSE`. Os arquivos são copiados do pacote npm, não
reimplementações nem código de Xournal++, OpenBoard, Okular ou Rnote.

Referências primárias: [PDF.js](https://github.com/mozilla/pdf.js),
[perfect-freehand](https://github.com/steveruizok/perfect-freehand),
[PyWinRT](https://github.com/pywinrt/pywinrt),
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR),
[python-pptx](https://github.com/scanny/python-pptx),
[pypdf](https://github.com/py-pdf/pypdf).

Vela, Qt/PyQt e as demais dependências existentes continuam com suas licenças
originais. O fluxo PPTX ativo não executa LibreOffice. O módulo legado
`readers/pptx/preview.py` não é chamado pelo serviço.

Renderer PPTX: [mdurbar/pptx-viewer](https://github.com/mdurbar/pptx-viewer).
ZIP: [fflate](https://github.com/101arrowz/fflate).
