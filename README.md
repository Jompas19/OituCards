# OituCards — V1.2

OituCards é um site estático de flashcards em que cada usuário cria os próprios baralhos.  
Nesta versão, os dados ficam salvos no **IndexedDB do próprio navegador**.

## O que já funciona

- Página inicial com lista de baralhos vazia no primeiro uso.
- Criar baralho.
- Renomear baralho.
- Excluir baralho com confirmação.
- Quantidade de cards por baralho.
- Campo de progresso preparado para integração com o futuro modo de estudo.
- Criar flashcards com Frente e Verso.
- Negrito, itálico e sublinhado.
- Lista com tópicos e lista numerada.
- Cor do texto: preto, branco, azul, verde, amarelo, rosa e vermelho.
- Cor de fundo do texto nas mesmas opções.
- Inserção de imagens na Frente e no Verso.
- Colar imagens diretamente no editor.
- Botões "Adicionar", "Adicionar e fechar" e "Cancelar".
- Validação exata quando Frente ou Verso estiver vazio.
- Tela enxuta de edição de baralho.
- Pesquisa pela Frente do flashcard.
- Editar apenas um flashcard.
- Excluir apenas um flashcard.
- Tema claro/escuro.
- Layout responsivo para celular e computador.
- Tela de "Importar baralho" reservada para implementação futura.

## Como abrir

A forma mais simples é abrir `index.html` em um navegador moderno.

Para uso publicado, hospede esta pasta em GitHub Pages, Cloudflare Pages ou outro serviço de hospedagem estática.

## Estrutura

```text
OituCards-v1/
├── index.html
├── css/
│   └── style.css
└── js/
    ├── db.js       # IndexedDB e persistência
    ├── editor.js   # editor rico, imagens e sanitização
    └── app.js      # interface, modais e regras da aplicação
```

## Dados

Os baralhos e cards ficam no IndexedDB com o nome:

`OituCardsDB`

Nesta V1, os dados não sincronizam entre dispositivos.

## Importação APKG

A interface de importação existe, mas o importador ainda não está habilitado.  
Ela foi isolada de propósito para podermos acrescentar suporte a `.apkg`, CSV e JSON depois sem reconstruir o restante do site.

## Próximos módulos possíveis

- modo de estudo;
- revelar resposta;
- Acertei / Incompleto / Errei / Não faço ideia;
- histórico;
- filtros;
- repetição espaçada;
- estatísticas;
- favoritos;
- exportação/backup;
- importação APKG;
- conta e sincronização.


## Ajustes V1.1

- Ordem dos botões: Adicionar → Adicionar e fechar → Cancelar.
- Seleção de cor por bolinhas, sem nomes visíveis.
- Após criar um baralho pela tela inicial, o usuário permanece na tela inicial.
- Ações de editar/apagar ficaram mais discretas, usando apenas ícones.


## Ajustes V1.2

- Controles de cor restaurados para o formato visível “Texto: Cor” e “Fundo: Cor”.
- As opções de cor continuam sendo exibidas apenas como bolinhas coloridas.
- Na página inicial, a ordem dos botões passou a ser “Criar baralho” e depois “Importar baralho”.
- “Adicionar baralho” foi renomeado para “Criar baralho”.
