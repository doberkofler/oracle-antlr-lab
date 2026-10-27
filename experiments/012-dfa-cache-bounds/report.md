# DFA cache bounds

Single full-corpus screening passes over 1,244 opaque files:

| Policy                   |           Core |       Peak RSS |    Diagnostics |      Fallbacks | Outcome                                        |
| ------------------------ | -------------: | -------------: | -------------: | -------------: | ---------------------------------------------- |
| Persistent cache control | 103.888 s mean |       6.546 GB |            107 |             15 | Fails default approximately 4 GB old-space     |
| Clear every 250 files    |      130.557 s |       4.558 GB |            107 |             15 | Completes; +25.7% core                         |
| Clear every 500 files    |      126.450 s |       4.640 GB |            107 |             15 | Completes; +21.7% core                         |
| Clear at 3,072 MiB heap  |      143.719 s |       3.887 GB |            107 |             15 | Completes; +38.3% core                         |
| Clear at 3,800 MiB heap  |         >600 s | Not reportable | Not reportable | Not reportable | Timed out after clearing in the expensive tail |

The interval and heap controls are opt-in through `LAB_DFA_CLEAR_EVERY` and `LAB_DFA_MAX_HEAP_MIB`. The production default remains persistent caching.

A focused test verifies parse-tree and diagnostic identity across a cache clear. A full cache-policy conformance campaign was attempted but rejected after exceeding 20 minutes during its second unoptimized state; it cannot be presented as completed evidence.

## Threats to validity

- Candidate screens are single passes; their large regressions do not need finer statistical resolution to reject them as defaults.
- Peak RSS is a process high-water mark and can remain above the configured V8 heap threshold.
- File order strongly affects when cache relearning occurs.
