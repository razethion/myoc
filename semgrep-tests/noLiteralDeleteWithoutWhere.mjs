// noinspection SqlWithoutWhere
// ruleid: myoc.scripts.no-literal-delete-without-where
const unsafeDelete = `DELETE FROM recent_feed_generations;`

// noinspection SqlWithoutWhere
// ruleid: myoc.scripts.no-literal-delete-without-where
const unsafeQuotedDelete = `delete from "recent_feed_revocations";`

// ok: myoc.scripts.no-literal-delete-without-where
const filteredDelete = `DELETE FROM recent_feed_generations
                        WHERE generation = ?;`

void [filteredDelete, unsafeDelete, unsafeQuotedDelete]
