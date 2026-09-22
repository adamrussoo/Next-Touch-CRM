---
name: GitHub connector publishing
description: How to verify source parity when the GitHub connector can write through the API but Git CLI lacks credentials.
---

When Git CLI push authentication is unavailable but the GitHub connector is authorized, use GitHub's Git Data API to create blobs, a tree based on the current remote head, a commit, and then advance the branch ref. Compare the resulting remote tree hash with the local commit tree hash; commit hashes can differ because the connector creates an API commit.

**Why:** The connector securely proxies GitHub API calls but does not expose a raw credential to Git CLI. Treating unequal commit hashes as source drift after an API publish gives a false failure when the trees are identical.

**How to apply:** Use this only when the remote branch is known and authorized for mutation. Parse file modes as only `100644` or `100755`, update the ref without force, fetch the result, and require exact tree-hash parity before reporting source synchronization.