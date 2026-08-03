# Avaliação de Legítimo Interesse (LIA)

> Modelo para preencher e versionar. A LGPD não exige um formato específico, mas exige que a avaliação **exista e seja demonstrável** — a ANPD pode pedir. Um documento datado e versionado no repositório é prova razoável de diligência.
>
> Isto é um modelo operacional, não parecer jurídico. Valide com seu advogado antes de escalar volume.

**Controlador:** _(razão social)_ · CNPJ _(número)_
**Encarregado (DPO):** _(nome)_ — _(e-mail)_
**Data:** _(preencher)_ · **Versão:** 1

---

## 1. Finalidade

Contato profissional B2B para apresentar _(produto/serviço)_ a pessoas cuja função na empresa tem relação direta com o problema que resolvemos.

Não há tratamento de dado pessoal sensível. Não há decisão automatizada com efeito jurídico sobre o titular. Não há enriquecimento com dados de vida pessoal.

## 2. Base legal

Legítimo interesse — art. 7º, IX, da Lei 13.709/2018.

Consentimento prévio não é a base adequada aqui: exigi-lo em prospecção B2B inviabilizaria o primeiro contato, e a LGPD não o impõe quando o tratamento é de dado profissional, em contexto profissional, com expectativa razoável do titular.

## 3. Dados tratados

| Dado | Origem | Necessidade |
|---|---|---|
| E-mail corporativo | _(descrever: site da empresa, LinkedIn, base pública, evento…)_ | Canal do contato |
| Nome | idem | Personalização mínima |
| Empresa e cargo | idem | Confirmar que a mensagem é pertinente à função |

Colunas adicionais importadas do CSV ficam em `contacts.custom` e devem se limitar ao contexto profissional.

## 4. Teste de balanceamento

**Necessidade.** Não há meio menos invasivo de apresentar uma solução B2B a um decisor específico. O volume é limitado por tetos diários por caixa e por domínio, e a segmentação restringe o alcance a funções pertinentes.

**Adequação.** Só tratamos dado profissional, em contexto profissional. Nada de dado pessoal sensível, nada de vida privada.

**Expectativa do titular.** Um profissional que publica o e-mail corporativo associado a um cargo espera contato comercial pertinente à função. A expectativa se rompe se a mensagem for irrelevante ao cargo, se o volume for abusivo ou se o pedido de saída for ignorado — os três são tratados nas salvaguardas.

**Direitos do titular.** Prevalecem sobre o interesse do controlador sempre que houver oposição. Por isso o opt-out é imediato, de um clique e sem login.

## 5. Salvaguardas implementadas

| Salvaguarda | Onde está no código |
|---|---|
| Rodapé com razão social, CNPJ, origem do dado e base legal, não removível pelo editor | `packages/core/src/compliance.ts` |
| Descadastro de um clique, sem login, mais `List-Unsubscribe-Post` (RFC 8058) | `apps/web/src/app/unsubscribe/[token]/route.ts` |
| Opt-out encerra **todas** as cadências daquele e-mail no workspace, não só a campanha de origem | `suppressEmail` em `packages/core/src/suppression.ts` |
| Supressão reconferida no momento do envio | `processSendJob` em `packages/core/src/send.ts` |
| Pedido de remoção por resposta é detectado e suprime automaticamente | `classifyReply` + `requiresSuppression` |
| Qualquer resposta interrompe a cadência | `handleInboundReply` em `packages/core/src/webhooks.ts` |
| Bounce e reclamação suprimem automaticamente | `handleEmailEvent` |
| Tetos de volume por caixa e por domínio, com rampa de aquecimento | `packages/core/src/warmup.ts`, `packages/core/src/capacity.ts` |
| Credenciais de envio cifradas em repouso (AES-256-GCM) | `packages/core/src/crypto.ts` |

## 6. Direitos dos titulares

Canal: _(privacy@seudominio)_ — **prazo de resposta: 15 dias.**

Confirmação de tratamento, acesso, correção, anonimização, eliminação, portabilidade e **oposição** ao tratamento por legítimo interesse. O pedido de oposição é atendido de imediato pela supressão, sem exigir justificativa.

## 7. Conclusão

O tratamento é adequado, necessário e proporcional à finalidade declarada, e as salvaguardas acima mantêm os direitos do titular preservados. **Revisar esta avaliação a cada 12 meses** ou sempre que mudar a origem dos dados, a finalidade ou o volume.

---

## Pendências antes de escalar volume

- [ ] Preencher os campos entre parênteses
- [ ] Publicar a política de privacidade em português e registrar a URL em Configurações
- [ ] Criar a caixa `privacy@` e definir quem responde em 15 dias
- [ ] Registrar por escrito a origem de cada lista importada (o campo `contacts.source` guarda o nome da lista, mas não a metodologia)
- [ ] Validação jurídica
