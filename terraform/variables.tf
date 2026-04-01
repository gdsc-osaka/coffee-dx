variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "worker_name" {
  description = "Name of the Worker script"
  type        = string
  default     = "coffee-dx"
}

variable "d1_database_name" {
  description = "Name of the D1 database"
  type        = string
  default     = "coffee-dx-db"
}
