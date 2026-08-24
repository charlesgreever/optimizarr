# Plan: Movies page health strip

Movies shows **total**, **healthy**, and **suggestions** at the top of the page, using the same healthy definition and pills as Series headers. Counts come from SQL on `GET /api/library/movies`, not from the 50 loaded rows.
