# Direct visual reasoning for altered movie shots

Source Match combines requested copy measurements with direct ChatGPT image
review. It does not recreate OpenAI model internals or infer footage from a
verbal description. The current ChatGPT session receives actual decoded evidence;
there is no hidden API call or additional model subscription in this path.

The [OpenAI vision documentation](https://developers.openai.com/api/docs/guides/images-vision)
supports comparing multiple supplied images and describes limitations in exact
spatial localization and image resizing. Accordingly, ChatGPT supplies qualitative
visual observations; decoded integer PTS and measured transforms supply coordinates
and source-frame identity.

## Evidence packet

Read `status.visualReasoning.packets` or `report.visualReasoningPackets`. Each
`shot-XXX-visual-reasoning.json` retains:

- Three actual edit/original frame pairs spread over the measured visible span,
  with explicit evidence IDs, original PTS/time bases and individual image paths.
- Measured alignment images and distributed geometric/edge/change witnesses.
- Nearby decoded original-frame controls, labeled as controls rather than matches.
- Both actual reference boundary images, including hidden or composite frames.
- Retained competing measured hypotheses, explicitly marking missing images.
- A concise review request and required response fields. `AWAITING_DIRECT_IMAGE_REVIEW`
  is deliberately not a generated model judgment.

The contact sheet helps navigate. Inspect individual images for fine landmarks,
pose differences and frame-level ambiguity. A normalized or warped source image
is labeled as a measured transform; original edit/source images remain available.
No image generation, inpainting or reconstructed hidden detail establishes proof.

## Review procedure

1. Look at the actual edit and original images before reading numerical scores.
   Identify distinctive pose, facial/armor landmarks, their relative arrangement
   and background/camera geometry. “Both contain Ultron” is insufficient.
2. Compare these correspondences at several moments. Explain visible crop,
   resizing, borders, captions, color changes, overlays or compositing. A coherent
   change should account for the shared picture and the differing regions.
3. Compare changing poses or motion across the original PTS sequence, including
   reverse or retimed traversal when supported. Static captions cannot establish
   temporal correspondence.
4. Inspect neighboring original frames and competing locations. Describe material
   contradictions. If an alternative image is absent, request it through GPT
   BROWSE or a bounded REFINE; do not claim to have visually rejected an unseen image.
5. Return `SAME_SHOT`, `DIFFERENT_SHOT` or `INSUFFICIENT_EVIDENCE`, with concise
   evidence-linked correspondences, alterations, motion observations, alternative
   checks, contradictions and any next evidence request.
6. Separately assess first/last boundaries as `OBSERVED`, `NOT_OBSERVABLE` or
   `AMBIGUOUS`. State original integer PTS only for an actually observed and
   adequately supported correspondence. Identity of a movie section does not
   reveal the source frame underneath a constant-black rendered endpoint.

Original author projects are not a prerequisite. Local measurements corroborate
observable picture identity; ChatGPT evaluates the visible explanation. Existing
GPT BROWSE/SELECT retains assignment decisions, and exact-range/assembly gates
still require all measured endpoints and direct reviews. A packet, similarity
score, source-section identity or review instruction cannot bypass those gates.
