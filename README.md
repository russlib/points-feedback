# Points feedback

Questions, feature requests, and bug reports for [points.russlib.ca](https://points.russlib.ca/).

Visitors use **Send feedback** beside the page title and submit directly on the site. No GitHub account is required. Notes are public; the form asks visitors to omit private details.

## Review

Use the [issues inbox](https://github.com/russlib/points-feedback/issues). Reply to request clarification, apply `question`, `enhancement`, or `bug` labels, and close answered or implemented requests. Anonymous visitors do not receive reply notifications.

## Delivery

The website saves notes in Cloudflare D1 immediately. `Sync anonymous feedback` runs on a five-minute schedule (GitHub scheduling can be delayed), or manually from Actions. It retrieves up to 20 pending notes, creates issues, and acknowledges them. If delivery fails, saved notes remain pending. A stable marker avoids duplicate issues when an acknowledgement needs retrying.

The workflow uses its repository-scoped `GITHUB_TOKEN` to create issues. The shared `FEEDBACK_SYNC_TOKEN` secret authenticates access to the site's pending/ack endpoints. No GitHub credentials are embedded in the webpage or Worker. Never print these secrets.

GitHub may disable scheduled workflows after 60 days without repository activity. If delivery stops, check Actions and re-enable the workflow; pending notes remain stored on the site. Manual dispatch can run it immediately.
