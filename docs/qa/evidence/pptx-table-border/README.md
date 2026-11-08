# Borda inferior da tabela PPTX

A tabela transparente de 10 linhas e 8 colunas reproduz a borda inferior
aberta quando o objeto é reduzido a uma altura em que o Qt recorta a borda
colapsada. Cada traço agora fica dentro da célula. As células compartilham
uma única linha interna, e as extremidades direita e inferior fecham a
grade. O estilo sem bordas continua transparente.

A regressão lê pixels no centro de cada uma das oito células da última
linha. Ela falha no editor da revisão anterior e passa no editor e no
modo de apresentação após a correção.

[Editor antes](editor-before.png) · [Editor depois](editor-after.png) ·
[Apresentação depois](presentation-after.png) · [Resultados](results.txt)
