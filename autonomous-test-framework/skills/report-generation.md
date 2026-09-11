# SKILL: Report Generator & Publisher
## Agent ID: 09-report-generator
## Version: 1.0.0

## Purpose
Generate comprehensive HTML and JSON execution reports, publish via Gmail SMTP.

## Report Sections
1. Summary cards: Total, Passed, Failed, Skipped, Pass Rate, Critical Bugs
2. Trend indicator: ▲/▼ vs previous run (from Project Memory)
3. Failed test table: TC Key, Name, Status, Retries, Error snippet
4. K6 performance table: Script, Status, p95 response, Error rate
5. Framework metrics: All-time totals from memory

## Output Files
- reports/html/report-{timestamp}.html   — Full HTML report
- reports/html/latest.html               — Alias always pointing to latest
- reports/json/exec-report-{timestamp}.json — Machine-readable

## Gmail Email
- Subject: [ARIA][ENV] Test Report — {passRate}% Pass | {failed} Failed
- Body: Inline HTML report
- Attachment: execution-report.html
- Threshold alert: Highlighted in red when pass rate < 80%

## Trend Calculation
delta = currentPassRate - memory.cycles[0].passRate
Displayed as: ▲ 5% vs last run OR ▼ 3% vs last run
