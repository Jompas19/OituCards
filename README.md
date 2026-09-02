# OituCards — v2

O **OituCards** é uma aplicação web de flashcards voltada para criação, organização e revisão ativa de conteúdos de estudo.

A versão atual funciona como uma aplicação **local-first**: baralhos, pastas, flashcards, progresso de revisão e anotações ficam salvos no **IndexedDB do próprio navegador**. Não há conta, servidor de dados ou sincronização entre dispositivos nesta versão.

> **Checkpoint estável atual:** OituCards v2  
> Commit: `0c5f2b2862ba1c041a921d554a25d1888cfa2fb1`  
> Branch de backup: `oitucards-v2`

---

## O que já funciona

### Biblioteca e organização

- Criação, renomeação e exclusão de baralhos.
- Criação de **pastas e subpastas**.
- Pastas recolhíveis em estrutura hierárquica.
- Emoji personalizado para cada pasta.
- Mover baralhos e pastas entre diferentes níveis da árvore.
- Proteção contra ciclos ao mover pastas.
- Seleção múltipla de baralhos e pastas.
- Ações em lote para:
  - estudar;
  - excluir;
  - mover;
  - exportar.
- Selecionar uma pasta inclui os baralhos e subpastas existentes dentro dela.
- Progresso e revisões exibidos na biblioteca.

### Flashcards

- Frente e verso em editor rico.
- Negrito, itálico e sublinhado.
- Lista com tópicos e lista numerada.
- Cores de texto.
- Cores de fundo do texto.
- Inserção de imagens.
- Colar imagens diretamente no editor.
- Flashcards somente com imagem também são aceitos.
- Pesquisa pela frente do flashcard.
- Edição individual.
- Exclusão individual.

### Estudo

- Estudo de um único baralho.
- Estudo conjunto de vários baralhos e/ou pastas.
- Pastas incluem automaticamente os baralhos existentes nas subpastas.
- Escolha da quantidade de flashcards da sessão.
- Opção **Fazer todos**.
- Embaralhamento da sessão.
- Filtros para estudar apenas:
  - cards novos;
  - revisões disponíveis.
- Revelação de resposta.
- Avaliação do flashcard em:
  - **Difícil**;
  - **Médio**;
  - **Bom**;
  - **Fácil**.
- Opção de rever o mesmo card novamente dentro da própria sessão.
- Navegação pelos cards da sessão.
- Atalhos de teclado durante o estudo.
- Cronômetro opcional, com pausa.
- Fluxo de saída antecipada da sessão com preservação do progresso já registrado.

### Repetição espaçada

O OituCards possui um sistema próprio de repetição espaçada.

Configuração padrão para **cards novos**:

| Avaliação | Próxima revisão |
| --- | ---: |
| Difícil | 1 dia |
| Médio | 2 dias |
| Bom | 4 dias |
| Fácil | 7 dias |

Nas revisões seguintes, o intervalo atual é multiplicado por:

| Avaliação | Multiplicador |
| --- | ---: |
| Difícil | × 1,2 |
| Médio | × 1,8 |
| Bom | × 2,5 |
| Fácil | × 4 |

- Intervalo máximo padrão: **180 dias**.
- O usuário pode personalizar os intervalos e multiplicadores.
- O limite máximo configurável pode chegar a **3650 dias**.
- Configurações podem existir por baralho ou por pasta.
- Uma configuração aplicada a uma pasta pode ser propagada para suas subpastas e baralhos.
- Alterações nas regras não modificam retroativamente revisões que já foram agendadas.

### Refazer baralho

Há dois modos:

- **Reiniciar progresso:** zera o histórico de revisão/agendamento dos cards e começa novamente.
- **Manter progresso:** refaz os cards naquele momento sem alterar o progresso ou a agenda já existente.

As duas opções podem ser selecionadas ou desmarcadas diretamente pelo retângulo ou pelo quadradinho correspondente.

### Anotações nos flashcards

Depois de revelar a resposta, o usuário pode adicionar **uma anotação persistente ao flashcard**.

A anotação possui editor rico com:

- negrito;
- itálico;
- sublinhado;
- listas;
- cores;
- imagens.

Depois de salva, ficam disponíveis as ações:

- **Ver anotação**;
- **Editar**;
- **Excluir**.

A anotação fica salva junto ao card e aparece novamente nas revisões futuras.

**Refazer baralho não apaga anotações.**

### Importação

Formatos suportados:

- `.apkg`;
- `.colpkg`;
- `.anki2`;
- `.anki21`;
- `.csv`;
- `.tsv`;
- `.txt`;
- `.json`.

Na importação de Anki:

- hierarquias como `Pasta::Subpasta::Baralho` são convertidas para a estrutura de pastas do OituCards;
- imagens incorporadas podem ser importadas;
- cards importados entram como **novos** no sistema de revisão do OituCards;
- o histórico de agendamento original do Anki não é importado;
- templates Anki muito personalizados podem não ser reproduzidos integralmente.

### Exportação APKG

O OituCards consegue exportar:

- um baralho;
- uma pasta;
- uma pasta com subpastas;
- múltiplos itens selecionados.

A hierarquia é preservada usando nomes no padrão do Anki, por exemplo:

`Medicina::Neurologia::Neurocirurgia`

Também são preservados:

- conteúdo HTML dos cards;
- imagens locais incorporadas aos flashcards.

O histórico de revisão do OituCards não é exportado para o agendamento do Anki; os cards entram no pacote como cards novos.

---

## Interface

- Tema claro e escuro.
- Layout responsivo.
- Camada específica de compatibilidade com dispositivos touch/mobile.
- Tooltips contextuais na preparação do estudo.
- Microanimações suaves de navegação e revelação.
- Animação de abertura e fechamento de árvores de pastas.
- Estados visuais para seleção de opções e checkboxes.
- Interface desenhada para manter o estudo rápido e com poucas distrações.

---

## Onde os dados ficam salvos

O banco local chama-se:

```text
OituCardsDB
```

Ele utiliza **IndexedDB**.

Atualmente são armazenados localmente, entre outros dados:

- pastas;
- baralhos;
- flashcards;
- imagens inseridas nos cards;
- configurações de revisão;
- histórico e próximo agendamento dos cards;
- anotações.

### Importante

Os dados pertencem ao **navegador + dispositivo + origem do site**.

Portanto:

- abrir o OituCards em outro computador não leva os dados automaticamente;
- outro navegador no mesmo computador possui outro armazenamento;
- limpar os dados do site/navegador pode apagar o IndexedDB;
- não há sincronização em nuvem na v2.

---

## Arquitetura atual

O projeto continua propositalmente simples e sem backend.

```text
GitHub
  ↓
Cloudflare Workers / Static Assets
  ↓
Navegador
  ↓
IndexedDB local
```

A aplicação é formada principalmente por HTML, CSS e JavaScript executados no navegador.

Estrutura principal:

```text
public/
├── index.html
├── _headers
├── css/
│   ├── style.css
│   ├── study.css
│   ├── import.css
│   ├── library.css
│   ├── library-performance.css
│   ├── export.css
│   ├── visual-refinement.css
│   ├── visual-polish.css
│   ├── study-tooltip-refinement.css
│   └── animations.css
└── js/
    ├── db.js
    ├── app.js
    ├── editor.js
    ├── study.js
    ├── study-next.js
    ├── study-exit-flow.js
    ├── multi-study.js
    ├── import.js
    ├── import-anki-compat.js
    ├── library.js
    ├── library-enhancements.js
    ├── library-performance.js
    ├── library-stability.js
    ├── export.js
    ├── study-annotations.js
    ├── mobile-compat.js
    ├── visual-refinement.js
    ├── visual-polish-lite.js
    └── animations.js
```

Algumas funcionalidades de importação/exportação de Anki dependem de bibliotecas JavaScript externas carregadas por CDN.

---

## Situação de desempenho

Para bibliotecas de tamanho normal, a interface atual está estável e responde rapidamente. Bibliotecas grandes utilizam resumos, metadados leves e carregamento sob demanda para não depender da leitura prévia de todo o conteúdo.

### Bibliotecas extremamente grandes

A aplicação possui uma camada estrutural específica para o cenário de aproximadamente **10 mil cards**, distribuídos em muitas pastas, subpastas e baralhos menores:

- a Home utiliza contadores agregados e não abre o conteúdo dos flashcards;
- os metadados de revisão ficam separados da frente, do verso e das anotações pesadas;
- as imagens do Anki são gravadas uma única vez como `Blob`, fora do HTML dos cards;
- cada imagem é carregada somente quando aparece na frente ou no verso exibido;
- o estudo combinado monta a fila a partir dos metadados e carrega o conteúdo de apenas um baralho por vez;
- a estrutura de pastas e baralhos é criada diretamente durante a importação, sem reorganização posterior;
- cards e mídias são persistidos em lotes limitados, com liberação periódica da interface.

Com isso, fechar e reabrir o site não exige reler os 10 mil conteúdos nem reconstruir as imagens para apresentar a biblioteca ou preparar uma sessão. O tempo absoluto da importação ainda depende do tamanho total das mídias, do navegador, do dispositivo e da velocidade do armazenamento local.

---

## Checkpoints de segurança

O projeto possui versões congeladas para recuperação.

### Versão base — Oficial

Commit:

```text
fe116b1d931ebd1366286c67229c1354ffd7198c
```

Branches:

```text
base-oficial
archive/base-oficial-2026-08-23
```

Esse checkpoint representa a antiga base oficial antes das etapas finais de refinamento visual e funcionalidades mais recentes.

### OituCards v2 — checkpoint atual

Commit:

```text
0c5f2b2862ba1c041a921d554a25d1888cfa2fb1
```

Branches:

```text
oitucards-v2
archive/oitucards-v2-2026-08-23
```

Essas branches devem permanecer congeladas.

Toda nova funcionalidade deve nascer da `main` em uma nova branch. Se uma mudança futura causar uma regressão grave, `oitucards-v2` é a referência atual de recuperação.

---

## Próximos passos possíveis

A v2 já cobre o ciclo principal de uso. As próximas evoluções podem ser feitas gradualmente, sem necessidade de alterar tudo ao mesmo tempo.

### Monitoramento de desempenho para bibliotecas gigantes

- manter testes de regressão com 10 mil ou mais cards;
- acompanhar tempo de descompactação de pacotes com muitas imagens;
- ajustar os tamanhos dos lotes conforme os resultados em navegadores e dispositivos distintos;
- preservar o carregamento sob demanda nas futuras funcionalidades.

### Backup completo do OituCards

A exportação APKG serve para interoperabilidade com Anki, mas não é um backup integral do estado do OituCards.

Uma evolução útil seria criar um formato próprio de backup contendo:

- pastas e hierarquia;
- baralhos;
- cards;
- imagens;
- anotações;
- configurações de revisão;
- progresso e histórico de cada card.

Assim seria possível restaurar toda a biblioteca em outro navegador ou computador.

### Estatísticas

Possibilidades:

- cards estudados por dia;
- taxa de acerto/desempenho por avaliação;
- revisões futuras;
- sequência de dias estudados;
- tempo de estudo;
- evolução por baralho ou pasta.

### Busca e organização avançada

- pesquisa global em todos os cards;
- tags;
- favoritos;
- cards marcados para revisão especial;
- filtros avançados.

### Sincronização entre dispositivos

Uma versão futura poderia oferecer conta e sincronização opcional em nuvem.

Isso exigiria uma mudança arquitetural importante, pois a v2 é totalmente local-first e não possui backend.

### PWA e modo offline

Possível evolução:

- instalação do OituCards como aplicativo;
- service worker;
- cache offline dos arquivos da aplicação;
- experiência mais próxima de um app nativo no celular.

### Compatibilidade Anki mais profunda

- suporte mais completo a templates customizados;
- tratamento aprimorado de mídia;
- opções adicionais de exportação/importação.

---

## Filosofia de desenvolvimento

Alguns princípios passaram a orientar o projeto depois das experiências da v2:

1. **Estabilidade antes de novas funcionalidades.**
2. Mudanças grandes devem ficar isoladas e ser facilmente reversíveis.
3. Evitar `MutationObserver` global/subtree quando uma solução orientada a eventos for suficiente.
4. Não carregar milhares de imagens ou cards completos apenas para calcular estatísticas.
5. Preservar IndexedDB e progresso do usuário em qualquer atualização.
6. Novas funcionalidades devem partir da `main` atual e passar por branch + PR antes do merge.
7. Checkpoints estáveis nunca devem ser reutilizados ou movidos.

---

## Estado atual

**OituCards v2 é a versão estável de referência do projeto.**

O fluxo principal já está completo:

**organizar → criar/importar → estudar → revisar → anotar → exportar.**

As próximas etapas são incrementais e podem ser desenvolvidas sem alterar a base que já está funcionando.
