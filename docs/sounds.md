# Recorded voice clips

The sale screen says the total and the change in Egyptian Arabic (UX-06). Until the clips exist it plays tones only and stays silent
otherwise (a sentence with a missing word is never spoken). Record each phrase short, clean, same voice and volume, and save as MP3
(mono, 64 kbps is plenty) in `public/sounds/ar/` with exactly these names.

| File            | Say                                                                                                                                             | File          | Say                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| `n0` … `n19`    | صفر، واحد، اتنين، تلاتة، أربعة، خمسة، ستة، سبعة، تمانية، تسعة، عشرة، حداشر، اتناشر، تلتاشر، أربعتاشر، خمستاشر، ستاشر، سبعتاشر، تمنتاشر، تسعتاشر | `t20` … `t90` | عشرين، تلاتين، أربعين، خمسين، ستين، سبعين، تمانين، تسعين |
| `h100`          | مية                                                                                                                                             | `h200`        | ميتين                                                    |
| `h300` … `h900` | تلتمية، ربعمية، خمسمية، ستمية، سبعمية، تمنمية، تسعمية                                                                                           | `thousand`    | ألف                                                      |
| `two_thousand`  | ألفين                                                                                                                                           | `c3` … `c10`  | تلات، أربع، خمس، ست، سبع، تمن، تسع، عشر                  |
| `thousands`     | تلاف                                                                                                                                            | `and`         | و                                                        |
| `egp`           | جنيه                                                                                                                                            | `piaster`     | قرش                                                      |
| `total`         | الإجمالي                                                                                                                                        | `change`      | الباقي                                                   |

That is 61 files. Example, 1,275.50: ألف و ميتين و خمسة و سبعين جنيه و خمسين قرش. The list of keys comes from `src/domain/speak.ts`.
