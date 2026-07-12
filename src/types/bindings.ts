export type Bindings = Omit<Env, 'CLOUDFLARE_ACCOUNT_ID' | 'D1_DATABASE_ID'> & {
    CLOUDFLARE_ACCOUNT_ID: string
    D1_DATABASE_ID: string
    D1_REST_API_TOKEN: string
}
