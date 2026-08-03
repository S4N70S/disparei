'use client'

import { useState, useTransition } from 'react'
import { Button, Card, Field, inputClass } from '@/components/ui'
import { importCsv } from './actions'
import { reasonLabel, type ImportReport } from './labels'

export function ImportForm() {
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    setError(null)
    setReport(null)
    startTransition(async () => {
      try {
        setReport(await importCsv(formData))
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const byReason = report
    ? report.discarded.reduce<Record<string, number>>((acc, d) => {
        acc[d.reason] = (acc[d.reason] ?? 0) + 1
        return acc
      }, {})
    : {}

  return (
    <Card className="p-5">
      <form action={onSubmit} className="space-y-4">
        <Field label="Nome da lista">
          <input
            name="listName"
            required
            placeholder="Ex.: Indústrias PE — set/2026"
            className={inputClass}
          />
        </Field>

        <Field
          label="Arquivo CSV"
          hint="As colunas são reconhecidas automaticamente (e-mail, nome, empresa, cargo). Qualquer outra coluna vira variável de template."
        >
          <input type="file" name="file" accept=".csv,text/csv" required className={inputClass} />
        </Field>

        <label className="flex items-start gap-2">
          <input type="checkbox" name="checkMx" defaultChecked className="mt-1" />
          <span className="text-sm">
            Verificar servidor de e-mail (MX)
            <span className="block text-xs text-[var(--color-muted)]">
              Mais lento, mas é o que evita bounce. Bounce acima de 4% suspende a conta no
              provedor.
            </span>
          </span>
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? 'Importando...' : 'Importar'}
        </Button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {report && (
        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
          <p className="text-sm font-semibold">
            {report.imported} de {report.totalRows} contatos importados para “{report.listName}”
          </p>

          {report.discarded.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium">
                {report.discarded.length} descartado(s) antes de entrar na base:
              </p>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(byReason).map(([reason, n]) => (
                  <li key={reason} className="text-sm text-[var(--color-muted)]">
                    {n} — {reasonLabel(reason as never)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.warnings.length > 0 && (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              {report.warnings.length} contato(s) com e-mail pessoal (gmail, hotmail…). Foram
              importados, mas costumam indicar lista de qualidade mais baixa em B2B.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
