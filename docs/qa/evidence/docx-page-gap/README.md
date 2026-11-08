# Vão entre páginas do DOCX

O contorno de foco do editor envolvia todo o documento. As folhas
cobriam o contorno, mas o vão deixava os dois traços azuis aparentes.
O contorno é suprimido no editor paginado. A seleção de texto continua
visível e o editor continua com foco.

O teste Qt seleciona texto entre duas folhas e registra a captura.
A revisão anterior falha com contorno `solid`. Após a correção o
contorno computado é `none` e a seleção continua ativa.

[Antes](before.png) · [Depois](after.png)
