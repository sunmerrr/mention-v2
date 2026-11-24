# Opinion briefing handoff · 2026-11-24

## Start here

Open `/Users/we/mention-internal`. The deployed briefing restoration is commit
`5944657` on `main`. Read the repository's `AGENTS.md` and `DECISIONS.md` before
editing. The previous workspace at `/Users/we/mention` holds the visual
reference. Its development script controls a different service. The production
web entry is http://127.0.0.1:8790/ and uses the `mention-live` Lima guest.

## Where the user stopped

The user's last implementation instruction was to restore the combined opinion
screen they could see in production and document the work. That restoration
was deployed, verified and committed. The current request is the handoff.

The earlier request, in the user's words, was:

> 이제 종합 여론에서 카톡과, 포커고수를 분리한것을 각각 '카톡 여론', '포커고수 여론' 페이지에 만들어주자. 유아이 똑같이. 가능하지?

The named destinations were the existing 카톡 여론 and 포커고수 여론 menu pages.
The extent of “분리한것” was interpreted by the previous session without first
confirming it with the user. A local attempt at two full source-filtered
briefings was reversed across 23 files. If the user reopens that request,
confirm which parts of the restored combined screen they mean before editing.
The handoff itself requires no deployment or collector action.

## Route and code map

| Page | Route | Production component |
| --- | --- | --- |
| 종합 여론 and its keyword tabs | `/`, `/combined`, `/combined/:target` | `apps/web/src/pages/OpinionBriefing.tsx` and `CombinedDetails.tsx` |
| 카톡 여론 | `/kakao` | `apps/web/src/pages/Overview.tsx` |
| 포커고수 여론 | `/pokergosu` | `apps/web/src/pages/Pokergosu.tsx` |
| Existing source-specific keyword detail | `/kakao/keywords/:target`, `/pokergosu/keywords/:target` | `apps/web/src/pages/Combined.tsx` |

Use `apps/web/src/App.tsx` for route ownership, `entry-server.tsx` for initial
SSR data, and `combined-query.ts` for query keys and drilldown URLs.
`packages/shared/src/monitoring/application/combined.ts` aggregates PostgreSQL
reads for the report. The reusable charts and cloud are under
`apps/web/src/design-system/`. The registered-keyword links open filtered
conversation or post lists. Related words appear in the keyword detail.

## Last verified state

At 14:59 KST the API was deployed as
`mention-local:live-20261124-briefing-restore-r2`. The collector intake,
analysis worker and PostgreSQL kept their existing containers. Verification
passed 58 unit and 67 integration tests. Production browser checks at 1440px
and 375px covered populated charts, the cloud, keyword tabs and both filtered
source lists. At that time the dashboard showed five targets and 28 subkeywords.
These counts are observations, not permanent expected values.

For a read-only check, open the combined page, select 개츠비, inspect its related
words and weekly charts, then return to 전체 브리핑. Compare the public and
loopback pages before diagnosing a visual regression. A healthy API alone
does not verify which screen is being served.

See [the restoration record](MIGRATION-STATUS.md#2026-11-24-opinion-briefing-restoration)
for the rollout, rollback reference and timings, and [the design system](DESIGN-SYSTEM.md)
for chart and SSR conventions.
