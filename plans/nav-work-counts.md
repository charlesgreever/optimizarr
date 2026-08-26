# Plan: Queue and Review counts in the sidebar

Sidebar Queue and Review show counts when there is active queue work or sidecars in Review. Header says Working · title while a job runs. `GET /api/work` is a small authed poll. Queue badge uses `queueActive` (waiting + running). Widget `queued` stays waiting-only.
