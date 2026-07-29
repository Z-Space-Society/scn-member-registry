-- Query: network.sharedcomputer.membership.listRequests
-- Lists membership applications from the firehose index. The underlying
-- records are public in each applicant's own PDS, Row from db.query is
-- the record's fields flat plus `uri` the applicant DID is derived from
-- the uri client-side.

function handle()
  local limit = tonumber(params.limit) or 50
  if limit > 100 then
    limit = 100
  end

  local res = db.query{
    collection = "network.sharedcomputer.membership.request",
    limit = limit,
    cursor = params.cursor,
    sort = "indexed_at",
    sortDirection = "desc",
  }

  return {
    requests = toarray(res.records or {}),
    cursor = res.cursor,
  }
end
