# Edit production authority

Practice and Pro Creation use `DURABLE_PRODUCTION_QUEUE_V1` exclusively.

- Run connection preflight, resume the retained active assignment, claim its controller,
  and read current research plans and actual AE state before production work.
- Submit every AE edit to `POST /v1/product/gpt/assignments/{id}/production-jobs`.
  Goals, batches, transactions, corrections, baseline assembly, renders, checkpoints,
  scratch searches and native proof scripts are operations inside that worker.
- Use `GET .../production-jobs?jobId={jobId}` to resume a submitted operation. Preserve
  its receipt on timeout. Reconcile interrupted/failed writes from actual state and
  retained evidence; never replay them blindly or switch to an older endpoint.
- Direct mutation URLs and compatibility aliases are removed. A `410` response is
  final for that route. Do not restart an old service or launch a parallel controller.
- The worker owns the single AE writer, scheduling, checkpoints and execution.
  GPT supplies creative judgment and strategy changes inside that system.
- M6 analysis, synthesis, tracking/roto, capability adapters, warm batch routines and
  proof libraries are integrated capabilities, not alternate production controllers.
- Practice retains reference fidelity and existing certification gates. Pro Creation
  has no Finish answer key and uses its designed target and actual render review.
- Tutorial Drive, Adobe resources, then external sources is the research order.
  Use provided raw footage/audio; keep AE open and preserve correct retained work.
- Standalone acceptance labs are isolated validation tools. They must not be used
  as a fallback production path for an active edit assignment.

# Production chat ownership

The local Production Supervisor arms automatically for Practice and Pro Creation.
Use only the private worker credential supplied in its continuation prompt as
`claimedBy`, `researchContext.claimedBy`, or `X-EditFlow-Worker-Credential` on every
assignment write. The gateway rejects missing, retired and wrong-assignment workers.
A `STALE_WORKER` response means stop immediately. Do not claim another identity,
read supervision keys, pause/reconfigure the supervisor, run native AE scripts or
use Desktop Commander to bypass the production queue. Only the supervisor may
revoke/issue worker generations. Resume existing receipts; accepted jobs belong
to the durable queue and can finish across a chat handoff. Only isolated automated
acceptance tests may set `productionSupervision: false`.
