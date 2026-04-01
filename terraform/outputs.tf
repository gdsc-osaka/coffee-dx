output "d1_database_id" {
  description = "D1 database UUID (wrangler.tomlで使用)"
  value       = cloudflare_d1_database.main.id
}
