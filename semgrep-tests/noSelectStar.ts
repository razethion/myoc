// ruleid: myoc.sql.no-select-star
const wildcardColumns = 'SELECT * FROM users'

// ruleid: myoc.sql.no-select-star
const lowercaseWildcardColumns = 'select   * from characters'

// ok: myoc.sql.no-select-star
const explicitColumns = 'SELECT id, email FROM users'

void [explicitColumns, lowercaseWildcardColumns, wildcardColumns]

export {}
