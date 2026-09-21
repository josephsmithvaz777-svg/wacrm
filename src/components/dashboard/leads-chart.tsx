"use client"

import { UserPlus } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import type { LeadsMonthPoint } from "@/lib/dashboard/types"
import { BarChart } from "@/components/tremor/bar-chart"
import { EmptyState } from "./empty-state"
import { Skeleton } from "./skeleton"

interface LeadsChartProps {
  data: LeadsMonthPoint[] | null
  loading: boolean
}

const CATEGORY = "leads"

export function LeadsChart({ data, loading }: LeadsChartProps) {
  const t = useTranslations("Dashboard.leadsChart")
  const locale = useLocale()
  const hasData = data?.some((p) => p.leads > 0) ?? false
  const total = data?.reduce((sum, p) => sum + p.leads, 0) ?? 0

  const chartData =
    data?.map((p) => ({
      month: shortMonth(p.month, locale),
      [CATEGORY]: p.leads,
    })) ?? []

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("description")}
          </p>
        </div>
        {hasData && (
          <div className="text-right text-xs text-muted-foreground">
            {t("total")}{" "}
            <span className="font-medium text-foreground tabular-nums">
              {total.toLocaleString()}
            </span>
          </div>
        )}
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={UserPlus}
            title={t("noLeads")}
            hint={t("noLeadsHint")}
          />
        ) : (
          <BarChart
            data={chartData}
            index="month"
            categories={[CATEGORY]}
            colors={["blue"]}
            valueFormatter={(value) => String(value)}
            showLegend={false}
            yAxisWidth={40}
            className="h-[260px]"
          />
        )}
      </div>
    </section>
  )
}

function shortMonth(key: string, locale: string): string {
  const [y, m] = key.split("-").map(Number)
  const date = new Date(y, m - 1, 1)
  return date.toLocaleDateString(locale, { month: "short", year: "2-digit" })
}
