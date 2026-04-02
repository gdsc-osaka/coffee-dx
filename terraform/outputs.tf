output "d1_database_id" {
  description = "D1 database UUID (wrangler.tomlで使用)"
  value       = cloudflare_d1_database.main.id
}

output "r2_tfstate_bucket" {
  description = "R2 bucket name for Terraform state"
  value       = cloudflare_r2_bucket.tfstate.name
}
