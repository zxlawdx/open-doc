/* Local help by task and document type; never surfaces internal JSON or logs. */
"use strict";
(() => {
  const topics={
    general:[
      ["Onde meus documentos ficam?","Seus arquivos ficam na biblioteca local do Open Doc. Arquivo > Exportar permite escolher uma pasta e um formato. Na primeira exportação, confira a mensagem ‘Salvo em’ para localizar o arquivo."],
      ["Como ampliar ou mudar o tema?","Ctrl++ e Ctrl+− ajustam o zoom da tela ou do documento ativo. Ctrl+0 volta a 100%. A engrenagem abre Aparência na Central e nos editores."],
      ["Como desfazer um erro?","Use Ctrl+Z (Desfazer) ou Ctrl+Y (Refazer). Se fechar o aplicativo antes de salvar, procure a opção de recuperação ao reabrir. Não exclua arquivos do workspace para tentar recuperar dados."],
      ["O documento não abre. O que faço?","Confirme se o arquivo está íntegro. Faça uma cópia do original, tente reimportá-la e utilize Arquivo > Abrir. Em caso de falha, mantenha a cópia original e copie a mensagem legível mostrada na interface."]
    ],
    pdf:[
      ["Por que o texto anotado não pode ser reescrito livremente?","O leitor PDF atual preserva o original e adiciona anotações. Ele não reconfigura a composição original dos parágrafos. Em PDFs digitais compatíveis, Editar PDF permite substituir trechos de texto e salvar uma cópia. A edição visual de imagens segue indisponível."],
      ["Como comentar um trecho?","Selecione o texto com o cursor e escolha Destacar ou Comentar. Use Ctrl+clique sobre a marcação para abrir o balão. Os comentários também ficam no painel à direita."],
      ["O leitor mudou de página. Como voltar?","Use o campo Página ou as miniaturas à esquerda. Se uma marcação deslocar a leitura sem você clicar em ‘Ir para página’, informe a página e a ação que ocasionaram o problema."],
      ["Como exportar apenas algumas páginas?","No leitor PDF, escolha Extrair páginas, informe o intervalo inicial e final e selecione o destino na janela do sistema. O arquivo importado permanece preservado."]
    ],
    pptx:[
      ["Como editar o texto de um slide?","Dê duplo clique sobre o texto na própria página. Ctrl+Enter confirma e Esc cancela. O painel à direita serve para detalhes adicionais."],
      ["Como redimensionar e girar uma forma?","Selecione o objeto, arraste uma das oito alças e use o controle redondo acima da seleção para girar. A rotação também pode ser ajustada pelas propriedades."],
      ["Como alterar cores rapidamente?","Abra a aba Formatar, escolha uma cor e ative o Balde. Clique na forma que deseja pintar; desative o balde quando terminar."],
      ["Por que alguns slides importados não são editáveis?","Apresentações existentes podem conter objetos, mestres e efeitos que ainda não são importados com fidelidade editável. O aplicativo preserva o original e evita converter silenciosamente objetos desconhecidos."]
    ],
    rich:[
      ["Como criar uma tabela?","Vá em Inserir > Tabela. Escolha linhas, colunas, modelo e espaçamento. Você também pode colar dados tabulados ou importar um CSV. Depois edite cada célula diretamente."],
      ["O layout mudou ao exportar. O que faço?","Salve uma cópia DOCX e compare com o original. Fontes indisponíveis e recursos avançados podem alterar a paginação. Ajuste a largura e as margens em Configuração da página."],
      ["Como inserir equações?","Vá em Inserir > Equação e calculadora. Escolha símbolos, componha sua expressão e confirme. A inserção usa o cursor ativo. Equações nativas e texto Unicode têm fluxos próprios no menu Inserir."]
    ]
  };
  class HelpCenter {
    static open({dialog,root,kind="rich"}){
      const selection=["pdf","pptx"].includes(kind)?kind:"rich";
      const promise=dialog("Central de ajuda · Open Doc",
        "Dúvidas frequentes, orientações de uso e como recuperar erros. Tudo disponível sem internet.");
      const container=root.querySelector("[data-dialog-body]");
      const box=container.closest(".dialog");box?.classList.add("dialog-help");
      const title=document.createElement("h3");
      title.textContent={pdf:"Leitura e anotações PDF",pptx:"Apresentações PPTX",rich:"Editor de documentos"}[selection];
      const section=document.createElement("div");section.className="help-entries";
      for(const [question,answer] of [...topics[selection],...topics.general]){
        const item=document.createElement("details");item.className="help-entry";
        const heading=document.createElement("summary");heading.textContent=question;
        const paragraph=document.createElement("p");paragraph.textContent=answer;
        item.append(heading,paragraph);section.append(item);
      }
      const recovery=document.createElement("p");
      recovery.textContent="Para pedir suporte, descreva a ação, a página ou slide afetado e o resultado esperado. Nunca compartilhe documentos confidenciais em relatórios públicos.";
      container.append(title,section,recovery);
      promise.finally(()=>box?.classList.remove("dialog-help"));
      return promise;
    }
  }
  window.OpenDocHelpCenter={HelpCenter,topics};
})();
