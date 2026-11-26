
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "attachments": {
                  Row: {
                    "business_id": string,"created_at": string,"entity_id": string,"entity_type": string,"id": string,"label": string | null,"mime_type": string,"size_bytes": number,"storage_path": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"entity_id": string,"entity_type": string,"id"?: string,"label"?: string | null,"mime_type": string,"size_bytes": number,"storage_path": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: string,"label"?: string | null,"mime_type"?: string,"size_bytes"?: number,"storage_path"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"business_id": string | null,"created_at": string,"diff": Json | null,"entity": string,"entity_id": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"business_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"entity": string,"entity_id"?: string | null,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"business_id"?: string | null,"created_at"?: string,"diff"?: Json | null,"entity"?: string,"entity_id"?: string | null,"id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"booking_services": {
                  Row: {
                    "booking_id": string,"business_id": string,"duration_min": number,"id": string,"quantity": number,"service_id": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id": string,"business_id": string,"duration_min": number,"id"?: string,"quantity"?: number,"service_id": string,"unit_price": number
                  }
                  Update: {
                    "booking_id"?: string,"business_id"?: string,"duration_min"?: number,"id"?: string,"quantity"?: number,"service_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_services_business_id_booking_id_fkey"
      columns: ["business_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "booking_services_business_id_service_id_fkey"
      columns: ["business_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "branch_id": string,"business_id": string,"cancelled_reason": string | null,"contact_email": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"created_by": string | null,"customer_id": string | null,"customer_note": string | null,"during": unknown,"employee_id": string | null,"ends_at": string,"id": string,"internal_note": string | null,"manage_token_hash": string | null,"plate_text": string | null,"quoted_total": number,"source": string,"starts_at": string,"status": Database["public"]['Enums']["booking_status"],"updated_at": string,"vehicle_id": string | null,"vehicle_params": NonNullable<Json>,"workstation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"business_id": string,"cancelled_reason"?: string | null,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_id"?: string | null,"customer_note"?: string | null,"during"?: never,"employee_id"?: string | null,"ends_at": string,"id"?: string,"internal_note"?: string | null,"manage_token_hash"?: string | null,"plate_text"?: string | null,"quoted_total"?: number,"source"?: string,"starts_at": string,"status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string,"vehicle_id"?: string | null,"vehicle_params"?: NonNullable<Json>,"workstation_id": string
                  }
                  Update: {
                    "branch_id"?: string,"business_id"?: string,"cancelled_reason"?: string | null,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"created_by"?: string | null,"customer_id"?: string | null,"customer_note"?: string | null,"during"?: never,"employee_id"?: string | null,"ends_at"?: string,"id"?: string,"internal_note"?: string | null,"manage_token_hash"?: string | null,"plate_text"?: string | null,"quoted_total"?: number,"source"?: string,"starts_at"?: string,"status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string,"vehicle_id"?: string | null,"vehicle_params"?: NonNullable<Json>,"workstation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "bookings_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "bookings_business_id_employee_id_fkey"
      columns: ["business_id","employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "bookings_business_id_vehicle_id_fkey"
      columns: ["business_id","vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "bookings_business_id_workstation_id_fkey"
      columns: ["business_id","workstation_id"]
isOneToOne: false
      referencedRelation: "workstations"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"branch_closures": {
                  Row: {
                    "branch_id": string,"business_id": string,"day": string,"id": string,"reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"business_id": string,"day": string,"id"?: string,"reason"?: string | null
                  }
                  Update: {
                    "branch_id"?: string,"business_id"?: string,"day"?: string,"id"?: string,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "branch_closures_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"branches": {
                  Row: {
                    "address_line": string | null,"business_id": string,"city": string | null,"country": string,"created_at": string,"deleted_at": string | null,"email": string | null,"id": string,"is_active": boolean,"name": string,"opening_hours": NonNullable<Json>,"phone": string | null,"postal_code": string | null,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line"?: string | null,"business_id": string,"city"?: string | null,"country"?: string,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"opening_hours"?: NonNullable<Json>,"phone"?: string | null,"postal_code"?: string | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "address_line"?: string | null,"business_id"?: string,"city"?: string | null,"country"?: string,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"opening_hours"?: NonNullable<Json>,"phone"?: string | null,"postal_code"?: string | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "branches_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"business_modules": {
                  Row: {
                    "business_id": string,"enabled": boolean,"module": Database["public"]['Enums']["module_key"]
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"enabled"?: boolean,"module": Database["public"]['Enums']["module_key"]
                  }
                  Update: {
                    "business_id"?: string,"enabled"?: boolean,"module"?: Database["public"]['Enums']["module_key"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_modules_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"business_settings": {
                  Row: {
                    "accent_color": string,"booking_cancel_until_minutes": number,"booking_horizon_days": number,"booking_lead_minutes": number,"booking_requires_confirmation": boolean,"brand_color": string,"business_id": string,"crm_locale": Database["public"]['Enums']["app_locale"],"currency": Database["public"]['Enums']["currency_code"],"default_tax_rate_bp": number,"email": string | null,"logo_path": string | null,"order_number_prefix": string,"phone": string | null,"prices_include_tax": boolean,"public_locale": Database["public"]['Enums']["app_locale"],"seasonal_mode": boolean,"slot_step_minutes": number,"storage_price_per_season": number,"tax_id": string | null,"timezone": string,"updated_at": string,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accent_color"?: string,"booking_cancel_until_minutes"?: number,"booking_horizon_days"?: number,"booking_lead_minutes"?: number,"booking_requires_confirmation"?: boolean,"brand_color"?: string,"business_id": string,"crm_locale"?: Database["public"]['Enums']["app_locale"],"currency"?: Database["public"]['Enums']["currency_code"],"default_tax_rate_bp"?: number,"email"?: string | null,"logo_path"?: string | null,"order_number_prefix"?: string,"phone"?: string | null,"prices_include_tax"?: boolean,"public_locale"?: Database["public"]['Enums']["app_locale"],"seasonal_mode"?: boolean,"slot_step_minutes"?: number,"storage_price_per_season"?: number,"tax_id"?: string | null,"timezone"?: string,"updated_at"?: string,"website"?: string | null
                  }
                  Update: {
                    "accent_color"?: string,"booking_cancel_until_minutes"?: number,"booking_horizon_days"?: number,"booking_lead_minutes"?: number,"booking_requires_confirmation"?: boolean,"brand_color"?: string,"business_id"?: string,"crm_locale"?: Database["public"]['Enums']["app_locale"],"currency"?: Database["public"]['Enums']["currency_code"],"default_tax_rate_bp"?: number,"email"?: string | null,"logo_path"?: string | null,"order_number_prefix"?: string,"phone"?: string | null,"prices_include_tax"?: boolean,"public_locale"?: Database["public"]['Enums']["app_locale"],"seasonal_mode"?: boolean,"slot_step_minutes"?: number,"storage_price_per_season"?: number,"tax_id"?: string | null,"timezone"?: string,"updated_at"?: string,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_settings_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"id": string,"is_active": boolean,"is_demo": boolean,"legal_name": string | null,"license_kind": string,"license_valid_until": string | null,"max_branches": number,"max_users": number,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"is_demo"?: boolean,"legal_name"?: string | null,"license_kind"?: string,"license_valid_until"?: string | null,"max_branches"?: number,"max_users"?: number,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"is_demo"?: boolean,"legal_name"?: string | null,"license_kind"?: string,"license_valid_until"?: string | null,"max_branches"?: number,"max_users"?: number,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"corporate_customers": {
                  Row: {
                    "billing_address": string | null,"business_id": string,"contact_email": string | null,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"deleted_at": string | null,"discount_bp": number,"id": string,"name": string,"notes": string | null,"payment_terms_days": number,"tax_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_address"?: string | null,"business_id": string,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"discount_bp"?: number,"id"?: string,"name": string,"notes"?: string | null,"payment_terms_days"?: number,"tax_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "billing_address"?: string | null,"business_id"?: string,"contact_email"?: string | null,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"discount_bp"?: number,"id"?: string,"name"?: string,"notes"?: string | null,"payment_terms_days"?: number,"tax_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "corporate_customers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"customer_consents": {
                  Row: {
                    "business_id": string,"customer_id": string,"granted": boolean,"id": string,"kind": string,"recorded_at": string,"recorded_by": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"customer_id": string,"granted": boolean,"id"?: string,"kind": string,"recorded_at"?: string,"recorded_by"?: string | null,"source"?: string
                  }
                  Update: {
                    "business_id"?: string,"customer_id"?: string,"granted"?: boolean,"id"?: string,"kind"?: string,"recorded_at"?: string,"recorded_by"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_consents_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"customer_tags": {
                  Row: {
                    "business_id": string,"customer_id": string,"tag_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"customer_id": string,"tag_id": string
                  }
                  Update: {
                    "business_id"?: string,"customer_id"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_tags_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "customer_tags_business_id_tag_id_fkey"
      columns: ["business_id","tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "anonymized_at": string | null,"business_id": string,"corporate_customer_id": string | null,"created_at": string,"deleted_at": string | null,"discount_bp": number,"email": string | null,"first_name": string,"id": string,"is_vip": boolean,"last_name": string,"last_visit_at": string | null,"locale": Database["public"]['Enums']["app_locale"],"merged_into": string | null,"notes": string | null,"phone": string | null,"phone_normalized": string | null,"preferred_channel": string,"source": string,"total_spent": number,"updated_at": string,"visits_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "anonymized_at"?: string | null,"business_id": string,"corporate_customer_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"discount_bp"?: number,"email"?: string | null,"first_name"?: string,"id"?: string,"is_vip"?: boolean,"last_name"?: string,"last_visit_at"?: string | null,"locale"?: Database["public"]['Enums']["app_locale"],"merged_into"?: string | null,"notes"?: string | null,"phone"?: string | null,"phone_normalized"?: never,"preferred_channel"?: string,"source"?: string,"total_spent"?: number,"updated_at"?: string,"visits_count"?: number
                  }
                  Update: {
                    "anonymized_at"?: string | null,"business_id"?: string,"corporate_customer_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"discount_bp"?: number,"email"?: string | null,"first_name"?: string,"id"?: string,"is_vip"?: boolean,"last_name"?: string,"last_visit_at"?: string | null,"locale"?: Database["public"]['Enums']["app_locale"],"merged_into"?: string | null,"notes"?: string | null,"phone"?: string | null,"phone_normalized"?: never,"preferred_channel"?: string,"source"?: string,"total_spent"?: number,"updated_at"?: string,"visits_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_business_id_corporate_customer_id_fkey"
      columns: ["business_id","corporate_customer_id"]
isOneToOne: false
      referencedRelation: "corporate_customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "customers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customers_business_id_merged_into_fkey"
      columns: ["business_id","merged_into"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"entity_id": string,"id": string,"kind": string,"locale": Database["public"]['Enums']["app_locale"],"number": string | null,"storage_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"entity_id": string,"id"?: string,"kind": string,"locale": Database["public"]['Enums']["app_locale"],"number"?: string | null,"storage_path"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"entity_id"?: string,"id"?: string,"kind"?: string,"locale"?: Database["public"]['Enums']["app_locale"],"number"?: string | null,"storage_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"duration_rules": {
                  Row: {
                    "adjustment": string,"amount": number,"business_id": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"priority": number,"rim_max": number | null,"rim_min": number | null,"rim_type": string | null,"runflat": boolean | null,"service_id": string | null,"tpms": boolean | null,"vehicle_category_id": string | null,"wheel_count_min": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "adjustment": string,"amount": number,"business_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"priority"?: number,"rim_max"?: number | null,"rim_min"?: number | null,"rim_type"?: string | null,"runflat"?: boolean | null,"service_id"?: string | null,"tpms"?: boolean | null,"vehicle_category_id"?: string | null,"wheel_count_min"?: number | null
                  }
                  Update: {
                    "adjustment"?: string,"amount"?: number,"business_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"priority"?: number,"rim_max"?: number | null,"rim_min"?: number | null,"rim_type"?: string | null,"runflat"?: boolean | null,"service_id"?: string | null,"tpms"?: boolean | null,"vehicle_category_id"?: string | null,"wheel_count_min"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "duration_rules_business_id_service_id_fkey"
      columns: ["business_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "duration_rules_business_id_vehicle_category_id_fkey"
      columns: ["business_id","vehicle_category_id"]
isOneToOne: false
      referencedRelation: "vehicle_categories"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"employee_absences": {
                  Row: {
                    "business_id": string,"created_at": string,"during": unknown,"employee_id": string,"id": string,"kind": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"during": unknown,"employee_id": string,"id"?: string,"kind": string,"note"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"during"?: unknown,"employee_id"?: string,"id"?: string,"kind"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "employee_absences_business_id_employee_id_fkey"
      columns: ["business_id","employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"employee_schedules": {
                  Row: {
                    "business_id": string,"employee_id": string,"ends": string,"id": string,"starts": string,"valid_from": string,"valid_to": string | null,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"employee_id": string,"ends": string,"id"?: string,"starts": string,"valid_from"?: string,"valid_to"?: string | null,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"employee_id"?: string,"ends"?: string,"id"?: string,"starts"?: string,"valid_from"?: string,"valid_to"?: string | null,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "employee_schedules_business_id_employee_id_fkey"
      columns: ["business_id","employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"employees": {
                  Row: {
                    "branch_id": string | null,"business_id": string,"color": string,"commission_bp": number,"created_at": string,"deleted_at": string | null,"email": string | null,"first_name": string,"id": string,"is_active": boolean,"last_name": string,"membership_id": string | null,"phone": string | null,"position": string | null,"skills": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id"?: string | null,"business_id": string,"color"?: string,"commission_bp"?: number,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"first_name": string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"membership_id"?: string | null,"phone"?: string | null,"position"?: string | null,"skills"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "branch_id"?: string | null,"business_id"?: string,"color"?: string,"commission_bp"?: number,"created_at"?: string,"deleted_at"?: string | null,"email"?: string | null,"first_name"?: string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"membership_id"?: string | null,"phone"?: string | null,"position"?: string | null,"skills"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "employees_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "employees_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employees_business_id_membership_id_fkey"
      columns: ["business_id","membership_id"]
isOneToOne: true
      referencedRelation: "memberships"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"branch_id": string | null,"business_id": string,"category": string,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"id": string,"note": string | null,"spent_on": string,"supplier_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"branch_id"?: string | null,"business_id": string,"category": string,"created_at"?: string,"created_by"?: string | null,"currency": Database["public"]['Enums']["currency_code"],"id"?: string,"note"?: string | null,"spent_on": string,"supplier_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"branch_id"?: string | null,"business_id"?: string,"category"?: string,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"id"?: string,"note"?: string | null,"spent_on"?: string,"supplier_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "expenses_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_business_id_supplier_id_fkey"
      columns: ["business_id","supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"idempotency_keys": {
                  Row: {
                    "business_id": string,"created_at": string,"key": string,"operation": string,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"key": string,"operation": string,"result": NonNullable<Json>
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"key"?: string,"operation"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "idempotency_keys_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"inbox_notifications": {
                  Row: {
                    "body": string | null,"business_id": string,"created_at": string,"id": string,"link": string | null,"permission": string | null,"read_at": string | null,"title": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"business_id": string,"created_at"?: string,"id"?: string,"link"?: string | null,"permission"?: string | null,"read_at"?: string | null,"title": string,"user_id"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"business_id"?: string,"created_at"?: string,"id"?: string,"link"?: string | null,"permission"?: string | null,"read_at"?: string | null,"title"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inbox_notifications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"note": string | null,"product_id": string,"quantity": number,"transfer_group": string | null,"unit_cost": number | null,"warehouse_id": string,"work_order_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"note"?: string | null,"product_id": string,"quantity": number,"transfer_group"?: string | null,"unit_cost"?: number | null,"warehouse_id": string,"work_order_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"note"?: string | null,"product_id"?: string,"quantity"?: number,"transfer_group"?: string | null,"unit_cost"?: number | null,"warehouse_id"?: string,"work_order_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_business_id_product_id_fkey"
      columns: ["business_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "inventory_movements_business_id_warehouse_id_fkey"
      columns: ["business_id","warehouse_id"]
isOneToOne: false
      referencedRelation: "warehouses"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "inventory_movements_business_id_work_order_id_fkey"
      columns: ["business_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"inventory_stock": {
                  Row: {
                    "avg_cost": number,"business_id": string,"on_hand": number,"product_id": string,"reserved": number,"warehouse_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avg_cost"?: number,"business_id": string,"on_hand"?: number,"product_id": string,"reserved"?: number,"warehouse_id": string
                  }
                  Update: {
                    "avg_cost"?: number,"business_id"?: string,"on_hand"?: number,"product_id"?: string,"reserved"?: number,"warehouse_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_stock_business_id_product_id_fkey"
      columns: ["business_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "inventory_stock_business_id_warehouse_id_fkey"
      columns: ["business_id","warehouse_id"]
isOneToOne: false
      referencedRelation: "warehouses"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"marketing_campaigns": {
                  Row: {
                    "bodies": NonNullable<Json>,"business_id": string,"channel": string,"created_at": string,"created_by": string | null,"id": string,"name": string,"scheduled_at": string | null,"segment": NonNullable<Json>,"sent_count": number,"status": string,"subject": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bodies": NonNullable<Json>,"business_id": string,"channel": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"scheduled_at"?: string | null,"segment"?: NonNullable<Json>,"sent_count"?: number,"status"?: string,"subject"?: Json | null
                  }
                  Update: {
                    "bodies"?: NonNullable<Json>,"business_id"?: string,"channel"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"scheduled_at"?: string | null,"segment"?: NonNullable<Json>,"sent_count"?: number,"status"?: string,"subject"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "marketing_campaigns_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "branch_ids": (string)[],"business_id": string,"created_at": string,"granted_permissions": (string)[],"id": string,"invited_by": string | null,"is_active": boolean,"revoked_permissions": (string)[],"role": Database["public"]['Enums']["app_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_ids"?: (string)[],"business_id": string,"created_at"?: string,"granted_permissions"?: (string)[],"id"?: string,"invited_by"?: string | null,"is_active"?: boolean,"revoked_permissions"?: (string)[],"role": Database["public"]['Enums']["app_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "branch_ids"?: (string)[],"business_id"?: string,"created_at"?: string,"granted_permissions"?: (string)[],"id"?: string,"invited_by"?: string | null,"is_active"?: boolean,"revoked_permissions"?: (string)[],"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_channels": {
                  Row: {
                    "business_id": string,"channel": string,"config": NonNullable<Json>,"is_enabled": boolean,"last_error": string | null,"provider": string,"updated_at": string,"vault_secret_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"channel": string,"config"?: NonNullable<Json>,"is_enabled"?: boolean,"last_error"?: string | null,"provider"?: string,"updated_at"?: string,"vault_secret_name"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"channel"?: string,"config"?: NonNullable<Json>,"is_enabled"?: boolean,"last_error"?: string | null,"provider"?: string,"updated_at"?: string,"vault_secret_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_channels_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_jobs": {
                  Row: {
                    "attempts": number,"body": string,"business_id": string,"campaign_id": string | null,"channel": string,"created_at": string,"customer_id": string | null,"dedupe_key": string,"entity_id": string | null,"entity_type": string | null,"event": string,"id": string,"is_marketing": boolean,"last_error": string | null,"locale": Database["public"]['Enums']["app_locale"],"locked_at": string | null,"locked_by": string | null,"max_attempts": number,"provider_message_id": string | null,"recipient": string,"run_at": string,"sent_at": string | null,"status": string,"subject": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body": string,"business_id": string,"campaign_id"?: string | null,"channel": string,"created_at"?: string,"customer_id"?: string | null,"dedupe_key": string,"entity_id"?: string | null,"entity_type"?: string | null,"event": string,"id"?: string,"is_marketing"?: boolean,"last_error"?: string | null,"locale"?: Database["public"]['Enums']["app_locale"],"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"provider_message_id"?: string | null,"recipient": string,"run_at"?: string,"sent_at"?: string | null,"status"?: string,"subject"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"body"?: string,"business_id"?: string,"campaign_id"?: string | null,"channel"?: string,"created_at"?: string,"customer_id"?: string | null,"dedupe_key"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"event"?: string,"id"?: string,"is_marketing"?: boolean,"last_error"?: string | null,"locale"?: Database["public"]['Enums']["app_locale"],"locked_at"?: string | null,"locked_by"?: string | null,"max_attempts"?: number,"provider_message_id"?: string | null,"recipient"?: string,"run_at"?: string,"sent_at"?: string | null,"status"?: string,"subject"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_jobs_business_id_campaign_id_fkey"
      columns: ["business_id","campaign_id"]
isOneToOne: false
      referencedRelation: "marketing_campaigns"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "notification_jobs_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "notification_jobs_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_logs": {
                  Row: {
                    "business_id": string,"created_at": string,"detail": string | null,"id": number,"job_id": string | null,"provider": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"detail"?: string | null,"id"?: never,"job_id"?: string | null,"provider"?: string | null,"status": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"detail"?: string | null,"id"?: never,"job_id"?: string | null,"provider"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_logs_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_logs_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "notification_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_templates": {
                  Row: {
                    "body": string,"business_id": string,"channel": string,"event": string,"id": string,"is_marketing": boolean,"locale": Database["public"]['Enums']["app_locale"],"subject": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"business_id": string,"channel": string,"event": string,"id"?: string,"is_marketing"?: boolean,"locale": Database["public"]['Enums']["app_locale"],"subject"?: string | null
                  }
                  Update: {
                    "body"?: string,"business_id"?: string,"channel"?: string,"event"?: string,"id"?: string,"is_marketing"?: boolean,"locale"?: Database["public"]['Enums']["app_locale"],"subject"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_templates_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"order_counters": {
                  Row: {
                    "business_id": string,"last_number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"last_number"?: number
                  }
                  Update: {
                    "business_id"?: string,"last_number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_counters_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_methods": {
                  Row: {
                    "business_id": string,"code": string,"id": string,"is_active": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"code": string,"id"?: string,"is_active"?: boolean,"name": string
                  }
                  Update: {
                    "business_id"?: string,"code"?: string,"id"?: string,"is_active"?: boolean,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_methods_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"business_id": string,"currency": Database["public"]['Enums']["currency_code"],"customer_id": string | null,"id": string,"idempotency_key": string | null,"kind": string,"method_id": string,"note": string | null,"received_at": string,"received_by": string | null,"reference": string | null,"refund_of": string | null,"storage_contract_id": string | null,"work_order_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"business_id": string,"currency": Database["public"]['Enums']["currency_code"],"customer_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"kind": string,"method_id": string,"note"?: string | null,"received_at"?: string,"received_by"?: string | null,"reference"?: string | null,"refund_of"?: string | null,"storage_contract_id"?: string | null,"work_order_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"business_id"?: string,"currency"?: Database["public"]['Enums']["currency_code"],"customer_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"kind"?: string,"method_id"?: string,"note"?: string | null,"received_at"?: string,"received_by"?: string | null,"reference"?: string | null,"refund_of"?: string | null,"storage_contract_id"?: string | null,"work_order_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "payments_business_id_method_id_fkey"
      columns: ["business_id","method_id"]
isOneToOne: false
      referencedRelation: "payment_methods"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "payments_business_id_refund_of_fkey"
      columns: ["business_id","refund_of"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "payments_business_id_storage_contract_id_fkey"
      columns: ["business_id","storage_contract_id"]
isOneToOne: false
      referencedRelation: "tire_storage_contracts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "payments_business_id_work_order_id_fkey"
      columns: ["business_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"permissions": {
                  Row: {
                    "code": string,"description": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"description": string
                  }
                  Update: {
                    "code"?: string,"description"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pricing_rules": {
                  Row: {
                    "adjustment": string,"amount": number,"business_id": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"priority": number,"rim_max": number | null,"rim_min": number | null,"rim_type": string | null,"runflat": boolean | null,"service_id": string | null,"tpms": boolean | null,"vehicle_category_id": string | null,"wheel_count_min": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "adjustment": string,"amount": number,"business_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"priority"?: number,"rim_max"?: number | null,"rim_min"?: number | null,"rim_type"?: string | null,"runflat"?: boolean | null,"service_id"?: string | null,"tpms"?: boolean | null,"vehicle_category_id"?: string | null,"wheel_count_min"?: number | null
                  }
                  Update: {
                    "adjustment"?: string,"amount"?: number,"business_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"priority"?: number,"rim_max"?: number | null,"rim_min"?: number | null,"rim_type"?: string | null,"runflat"?: boolean | null,"service_id"?: string | null,"tpms"?: boolean | null,"vehicle_category_id"?: string | null,"wheel_count_min"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pricing_rules_business_id_service_id_fkey"
      columns: ["business_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "pricing_rules_business_id_vehicle_category_id_fkey"
      columns: ["business_id","vehicle_category_id"]
isOneToOne: false
      referencedRelation: "vehicle_categories"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"products": {
                  Row: {
                    "attributes": NonNullable<Json>,"barcode": string | null,"business_id": string,"category": string,"created_at": string,"deleted_at": string | null,"id": string,"is_active": boolean,"location_note": string | null,"manufacturer": string | null,"min_stock": number,"name": string,"purchase_price": number,"retail_price": number,"sku": string,"supplier_id": string | null,"tax_rate_bp": number | null,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attributes"?: NonNullable<Json>,"barcode"?: string | null,"business_id": string,"category": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"location_note"?: string | null,"manufacturer"?: string | null,"min_stock"?: number,"name": string,"purchase_price"?: number,"retail_price"?: number,"sku": string,"supplier_id"?: string | null,"tax_rate_bp"?: number | null,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attributes"?: NonNullable<Json>,"barcode"?: string | null,"business_id"?: string,"category"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"is_active"?: boolean,"location_note"?: string | null,"manufacturer"?: string | null,"min_stock"?: number,"name"?: string,"purchase_price"?: number,"retail_price"?: number,"sku"?: string,"supplier_id"?: string | null,"tax_rate_bp"?: number | null,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_business_id_supplier_id_fkey"
      columns: ["business_id","supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"last_business_id": string | null,"locale": Database["public"]['Enums']["app_locale"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string,"id": string,"last_business_id"?: string | null,"locale"?: Database["public"]['Enums']["app_locale"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"last_business_id"?: string | null,"locale"?: Database["public"]['Enums']["app_locale"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"public_rate_limits": {
                  Row: {
                    "bucket": string,"hits": number,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"hits"?: number,"window_start": string
                  }
                  Update: {
                    "bucket"?: string,"hits"?: number,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"created_at": string,"endpoint": string,"id": string,"p256dh": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"created_at"?: string,"endpoint": string,"id"?: string,"p256dh": string,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"created_at"?: string,"endpoint"?: string,"id"?: string,"p256dh"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"resource_occupancies": {
                  Row: {
                    "block_reason": string | null,"booking_id": string | null,"branch_id": string,"business_id": string,"created_at": string,"created_by": string | null,"during": unknown,"id": string,"resource_id": string,"resource_kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "block_reason"?: string | null,"booking_id"?: string | null,"branch_id": string,"business_id": string,"created_at"?: string,"created_by"?: string | null,"during": unknown,"id"?: string,"resource_id": string,"resource_kind": string
                  }
                  Update: {
                    "block_reason"?: string | null,"booking_id"?: string | null,"branch_id"?: string,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"during"?: unknown,"id"?: string,"resource_id"?: string,"resource_kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_occupancies_business_id_booking_id_fkey"
      columns: ["business_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "resource_occupancies_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "resource_occupancies_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"role_permissions": {
                  Row: {
                    "permission": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "permission": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  Update: {
                    "permission"?: string,"role"?: Database["public"]['Enums']["app_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_fkey"
      columns: ["permission"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["code"]
    }
                  ]
                },"service_categories": {
                  Row: {
                    "business_id": string,"code": string | null,"id": string,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"code"?: string | null,"id"?: string,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "business_id"?: string,"code"?: string | null,"id"?: string,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_categories_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"service_workstations": {
                  Row: {
                    "business_id": string,"service_id": string,"workstation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"service_id": string,"workstation_id": string
                  }
                  Update: {
                    "business_id"?: string,"service_id"?: string,"workstation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_workstations_business_id_service_id_fkey"
      columns: ["business_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "service_workstations_business_id_workstation_id_fkey"
      columns: ["business_id","workstation_id"]
isOneToOne: false
      referencedRelation: "workstations"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"services": {
                  Row: {
                    "base_duration_min": number,"base_price": number,"business_id": string,"category_id": string | null,"created_at": string,"deleted_at": string | null,"description": string | null,"id": string,"is_active": boolean,"name": string,"online_bookable": boolean,"required_equipment": (string)[],"required_skills": (string)[],"sort_order": number,"tax_rate_bp": number | null,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_duration_min": number,"base_price": number,"business_id": string,"category_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"online_bookable"?: boolean,"required_equipment"?: (string)[],"required_skills"?: (string)[],"sort_order"?: number,"tax_rate_bp"?: number | null,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "base_duration_min"?: number,"base_price"?: number,"business_id"?: string,"category_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"online_bookable"?: boolean,"required_equipment"?: (string)[],"required_skills"?: (string)[],"sort_order"?: number,"tax_rate_bp"?: number | null,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_business_id_category_id_fkey"
      columns: ["business_id","category_id"]
isOneToOne: false
      referencedRelation: "service_categories"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"storage_locations": {
                  Row: {
                    "business_id": string,"capacity_sets": number,"cell": number,"code": string | null,"id": string,"is_active": boolean,"occupied_sets": number,"rack": number,"shelf": number,"warehouse_id": string,"zone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"capacity_sets"?: number,"cell": number,"code"?: never,"id"?: string,"is_active"?: boolean,"occupied_sets"?: number,"rack": number,"shelf": number,"warehouse_id": string,"zone": string
                  }
                  Update: {
                    "business_id"?: string,"capacity_sets"?: number,"cell"?: number,"code"?: never,"id"?: string,"is_active"?: boolean,"occupied_sets"?: number,"rack"?: number,"shelf"?: number,"warehouse_id"?: string,"zone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "storage_locations_business_id_warehouse_id_fkey"
      columns: ["business_id","warehouse_id"]
isOneToOne: false
      referencedRelation: "warehouses"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "business_id": string,"contact": string | null,"created_at": string,"email": string | null,"id": string,"name": string,"phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"contact"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"name": string,"phone"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"contact"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string,"phone"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"support_access_grants": {
                  Row: {
                    "admin_user_id": string,"business_id": string,"created_at": string,"expires_at": string,"granted_by": string,"id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_user_id": string,"business_id": string,"created_at"?: string,"expires_at": string,"granted_by": string,"id"?: string,"reason": string
                  }
                  Update: {
                    "admin_user_id"?: string,"business_id"?: string,"created_at"?: string,"expires_at"?: string,"granted_by"?: string,"id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_access_grants_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"tags": {
                  Row: {
                    "business_id": string,"color": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"color"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "business_id"?: string,"color"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tags_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"tire_set_items": {
                  Row: {
                    "business_id": string,"damage": string | null,"dot": string | null,"id": string,"photo_paths": (string)[],"position": string,"tire_set_id": string,"tread_mm": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"damage"?: string | null,"dot"?: string | null,"id"?: string,"photo_paths"?: (string)[],"position": string,"tire_set_id": string,"tread_mm"?: number | null
                  }
                  Update: {
                    "business_id"?: string,"damage"?: string | null,"dot"?: string | null,"id"?: string,"photo_paths"?: (string)[],"position"?: string,"tire_set_id"?: string,"tread_mm"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tire_set_items_business_id_tire_set_id_fkey"
      columns: ["business_id","tire_set_id"]
isOneToOne: false
      referencedRelation: "tire_sets"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"tire_sets": {
                  Row: {
                    "business_id": string,"code": string,"condition": string,"corporate_customer_id": string | null,"created_at": string,"customer_id": string,"diameter": number | null,"id": string,"load_index": string | null,"location_id": string | null,"manufacturer": string | null,"model": string | null,"notes": string | null,"profile": number | null,"quantity": number,"rim_type": string | null,"season": string,"speed_index": string | null,"status": string,"updated_at": string,"vehicle_id": string | null,"width": number | null,"with_rims": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"code": string,"condition"?: string,"corporate_customer_id"?: string | null,"created_at"?: string,"customer_id": string,"diameter"?: number | null,"id"?: string,"load_index"?: string | null,"location_id"?: string | null,"manufacturer"?: string | null,"model"?: string | null,"notes"?: string | null,"profile"?: number | null,"quantity"?: number,"rim_type"?: string | null,"season": string,"speed_index"?: string | null,"status"?: string,"updated_at"?: string,"vehicle_id"?: string | null,"width"?: number | null,"with_rims"?: boolean
                  }
                  Update: {
                    "business_id"?: string,"code"?: string,"condition"?: string,"corporate_customer_id"?: string | null,"created_at"?: string,"customer_id"?: string,"diameter"?: number | null,"id"?: string,"load_index"?: string | null,"location_id"?: string | null,"manufacturer"?: string | null,"model"?: string | null,"notes"?: string | null,"profile"?: number | null,"quantity"?: number,"rim_type"?: string | null,"season"?: string,"speed_index"?: string | null,"status"?: string,"updated_at"?: string,"vehicle_id"?: string | null,"width"?: number | null,"with_rims"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "tire_sets_business_id_corporate_customer_id_fkey"
      columns: ["business_id","corporate_customer_id"]
isOneToOne: false
      referencedRelation: "corporate_customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "tire_sets_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "tire_sets_business_id_location_id_fkey"
      columns: ["business_id","location_id"]
isOneToOne: false
      referencedRelation: "storage_locations"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "tire_sets_business_id_vehicle_id_fkey"
      columns: ["business_id","vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"tire_storage_contracts": {
                  Row: {
                    "business_id": string,"closed_at": string | null,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"ends_on": string,"extended_from": string | null,"id": string,"number": string,"paid_total": number,"price": number,"starts_on": string,"status": string,"tire_set_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": Database["public"]['Enums']["currency_code"],"ends_on": string,"extended_from"?: string | null,"id"?: string,"number": string,"paid_total"?: number,"price": number,"starts_on": string,"status"?: string,"tire_set_id": string
                  }
                  Update: {
                    "business_id"?: string,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"ends_on"?: string,"extended_from"?: string | null,"id"?: string,"number"?: string,"paid_total"?: number,"price"?: number,"starts_on"?: string,"status"?: string,"tire_set_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tire_storage_contracts_business_id_extended_from_fkey"
      columns: ["business_id","extended_from"]
isOneToOne: false
      referencedRelation: "tire_storage_contracts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "tire_storage_contracts_business_id_tire_set_id_fkey"
      columns: ["business_id","tire_set_id"]
isOneToOne: false
      referencedRelation: "tire_sets"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"tire_storage_movements": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"from_location_id": string | null,"id": number,"kind": string,"note": string | null,"tire_set_id": string,"to_location_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"from_location_id"?: string | null,"id"?: never,"kind": string,"note"?: string | null,"tire_set_id": string,"to_location_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"from_location_id"?: string | null,"id"?: never,"kind"?: string,"note"?: string | null,"tire_set_id"?: string,"to_location_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tire_storage_movements_business_id_from_location_id_fkey"
      columns: ["business_id","from_location_id"]
isOneToOne: false
      referencedRelation: "storage_locations"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "tire_storage_movements_business_id_tire_set_id_fkey"
      columns: ["business_id","tire_set_id"]
isOneToOne: false
      referencedRelation: "tire_sets"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "tire_storage_movements_business_id_to_location_id_fkey"
      columns: ["business_id","to_location_id"]
isOneToOne: false
      referencedRelation: "storage_locations"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"vehicle_categories": {
                  Row: {
                    "business_id": string,"code": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"code": string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "business_id"?: string,"code"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicle_categories_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"vehicles": {
                  Row: {
                    "body_type": string | null,"business_id": string,"category_id": string | null,"corporate_customer_id": string | null,"created_at": string,"customer_id": string | null,"deleted_at": string | null,"has_runflat": boolean,"has_tpms": boolean,"id": string,"make": string,"mileage_km": number | null,"model": string,"plate": string | null,"plate_normalized": string | null,"rim_diameter": number | null,"service_notes": string | null,"tire_size": string | null,"updated_at": string,"vin": string | null,"year": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body_type"?: string | null,"business_id": string,"category_id"?: string | null,"corporate_customer_id"?: string | null,"created_at"?: string,"customer_id"?: string | null,"deleted_at"?: string | null,"has_runflat"?: boolean,"has_tpms"?: boolean,"id"?: string,"make": string,"mileage_km"?: number | null,"model"?: string,"plate"?: string | null,"plate_normalized"?: never,"rim_diameter"?: number | null,"service_notes"?: string | null,"tire_size"?: string | null,"updated_at"?: string,"vin"?: string | null,"year"?: number | null
                  }
                  Update: {
                    "body_type"?: string | null,"business_id"?: string,"category_id"?: string | null,"corporate_customer_id"?: string | null,"created_at"?: string,"customer_id"?: string | null,"deleted_at"?: string | null,"has_runflat"?: boolean,"has_tpms"?: boolean,"id"?: string,"make"?: string,"mileage_km"?: number | null,"model"?: string,"plate"?: string | null,"plate_normalized"?: never,"rim_diameter"?: number | null,"service_notes"?: string | null,"tire_size"?: string | null,"updated_at"?: string,"vin"?: string | null,"year"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "vehicles_business_id_category_id_fkey"
      columns: ["business_id","category_id"]
isOneToOne: false
      referencedRelation: "vehicle_categories"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "vehicles_business_id_corporate_customer_id_fkey"
      columns: ["business_id","corporate_customer_id"]
isOneToOne: false
      referencedRelation: "corporate_customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "vehicles_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "vehicles_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"waiting_list": {
                  Row: {
                    "branch_id": string,"business_id": string,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"customer_id": string | null,"earliest": string,"id": string,"latest": string,"note": string | null,"offered_at": string | null,"service_ids": (string)[],"status": string,"vehicle_params": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"business_id": string,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"customer_id"?: string | null,"earliest": string,"id"?: string,"latest": string,"note"?: string | null,"offered_at"?: string | null,"service_ids"?: (string)[],"status"?: string,"vehicle_params"?: NonNullable<Json>
                  }
                  Update: {
                    "branch_id"?: string,"business_id"?: string,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"customer_id"?: string | null,"earliest"?: string,"id"?: string,"latest"?: string,"note"?: string | null,"offered_at"?: string | null,"service_ids"?: (string)[],"status"?: string,"vehicle_params"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "waiting_list_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "waiting_list_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"warehouses": {
                  Row: {
                    "branch_id": string,"business_id": string,"created_at": string,"id": string,"name": string,"purpose": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"business_id": string,"created_at"?: string,"id"?: string,"name": string,"purpose": string
                  }
                  Update: {
                    "branch_id"?: string,"business_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"purpose"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "warehouses_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"work_order_items": {
                  Row: {
                    "approval": string,"business_id": string,"created_at": string,"discount_bp": number,"employee_id": string | null,"id": string,"is_additional": boolean,"kind": string,"line_tax": number,"line_total": number,"name": string,"product_id": string | null,"quantity": number,"service_id": string | null,"sort_order": number,"tax_rate_bp": number,"unit_price": number,"warehouse_id": string | null,"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approval"?: string,"business_id": string,"created_at"?: string,"discount_bp"?: number,"employee_id"?: string | null,"id"?: string,"is_additional"?: boolean,"kind": string,"line_tax"?: number,"line_total"?: number,"name": string,"product_id"?: string | null,"quantity": number,"service_id"?: string | null,"sort_order"?: number,"tax_rate_bp": number,"unit_price": number,"warehouse_id"?: string | null,"work_order_id": string
                  }
                  Update: {
                    "approval"?: string,"business_id"?: string,"created_at"?: string,"discount_bp"?: number,"employee_id"?: string | null,"id"?: string,"is_additional"?: boolean,"kind"?: string,"line_tax"?: number,"line_total"?: number,"name"?: string,"product_id"?: string | null,"quantity"?: number,"service_id"?: string | null,"sort_order"?: number,"tax_rate_bp"?: number,"unit_price"?: number,"warehouse_id"?: string | null,"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_items_business_id_employee_id_fkey"
      columns: ["business_id","employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_order_items_business_id_product_id_fkey"
      columns: ["business_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_order_items_business_id_service_id_fkey"
      columns: ["business_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_order_items_business_id_warehouse_id_fkey"
      columns: ["business_id","warehouse_id"]
isOneToOne: false
      referencedRelation: "warehouses"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_order_items_business_id_work_order_id_fkey"
      columns: ["business_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"work_order_status_history": {
                  Row: {
                    "business_id": string,"changed_at": string,"changed_by": string | null,"from_status": Database["public"]['Enums']["work_order_status"] | null,"id": number,"note": string | null,"to_status": Database["public"]['Enums']["work_order_status"],"work_order_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"changed_at"?: string,"changed_by"?: string | null,"from_status"?: Database["public"]['Enums']["work_order_status"] | null,"id"?: never,"note"?: string | null,"to_status": Database["public"]['Enums']["work_order_status"],"work_order_id": string
                  }
                  Update: {
                    "business_id"?: string,"changed_at"?: string,"changed_by"?: string | null,"from_status"?: Database["public"]['Enums']["work_order_status"] | null,"id"?: never,"note"?: string | null,"to_status"?: Database["public"]['Enums']["work_order_status"],"work_order_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_status_history_business_id_work_order_id_fkey"
      columns: ["business_id","work_order_id"]
isOneToOne: false
      referencedRelation: "work_orders"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"work_orders": {
                  Row: {
                    "booking_id": string | null,"branch_id": string,"business_id": string,"completed_at": string | null,"corporate_customer_id": string | null,"created_at": string,"created_by": string | null,"currency": Database["public"]['Enums']["currency_code"],"customer_id": string | null,"customer_note": string | null,"damage_notes": string | null,"discount_total": number,"due_date": string | null,"employee_id": string | null,"id": string,"internal_note": string | null,"mileage_km": number | null,"number": string,"order_discount_bp": number,"paid_total": number,"payment_status": Database["public"]['Enums']["payment_status"],"prices_include_tax": boolean,"started_at": string | null,"status": Database["public"]['Enums']["work_order_status"],"subtotal": number,"tax_total": number,"total": number,"updated_at": string,"vehicle_id": string | null,"vehicle_params": NonNullable<Json>,"workstation_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"branch_id": string,"business_id": string,"completed_at"?: string | null,"corporate_customer_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": Database["public"]['Enums']["currency_code"],"customer_id"?: string | null,"customer_note"?: string | null,"damage_notes"?: string | null,"discount_total"?: number,"due_date"?: string | null,"employee_id"?: string | null,"id"?: string,"internal_note"?: string | null,"mileage_km"?: number | null,"number": string,"order_discount_bp"?: number,"paid_total"?: number,"payment_status"?: Database["public"]['Enums']["payment_status"],"prices_include_tax": boolean,"started_at"?: string | null,"status"?: Database["public"]['Enums']["work_order_status"],"subtotal"?: number,"tax_total"?: number,"total"?: number,"updated_at"?: string,"vehicle_id"?: string | null,"vehicle_params"?: NonNullable<Json>,"workstation_id"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"branch_id"?: string,"business_id"?: string,"completed_at"?: string | null,"corporate_customer_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: Database["public"]['Enums']["currency_code"],"customer_id"?: string | null,"customer_note"?: string | null,"damage_notes"?: string | null,"discount_total"?: number,"due_date"?: string | null,"employee_id"?: string | null,"id"?: string,"internal_note"?: string | null,"mileage_km"?: number | null,"number"?: string,"order_discount_bp"?: number,"paid_total"?: number,"payment_status"?: Database["public"]['Enums']["payment_status"],"prices_include_tax"?: boolean,"started_at"?: string | null,"status"?: Database["public"]['Enums']["work_order_status"],"subtotal"?: number,"tax_total"?: number,"total"?: number,"updated_at"?: string,"vehicle_id"?: string | null,"vehicle_params"?: NonNullable<Json>,"workstation_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_orders_business_id_booking_id_fkey"
      columns: ["business_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_orders_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_orders_business_id_corporate_customer_id_fkey"
      columns: ["business_id","corporate_customer_id"]
isOneToOne: false
      referencedRelation: "corporate_customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_orders_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_orders_business_id_employee_id_fkey"
      columns: ["business_id","employee_id"]
isOneToOne: false
      referencedRelation: "employees"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_orders_business_id_vehicle_id_fkey"
      columns: ["business_id","vehicle_id"]
isOneToOne: false
      referencedRelation: "vehicles"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "work_orders_business_id_workstation_id_fkey"
      columns: ["business_id","workstation_id"]
isOneToOne: false
      referencedRelation: "workstations"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"workstation_schedules": {
                  Row: {
                    "business_id": string,"ends": string,"id": string,"starts": string,"valid_from": string,"valid_to": string | null,"weekday": number,"workstation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"ends": string,"id"?: string,"starts": string,"valid_from"?: string,"valid_to"?: string | null,"weekday": number,"workstation_id": string
                  }
                  Update: {
                    "business_id"?: string,"ends"?: string,"id"?: string,"starts"?: string,"valid_from"?: string,"valid_to"?: string | null,"weekday"?: number,"workstation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workstation_schedules_business_id_workstation_id_fkey"
      columns: ["business_id","workstation_id"]
isOneToOne: false
      referencedRelation: "workstations"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"workstations": {
                  Row: {
                    "branch_id": string,"business_id": string,"created_at": string,"deleted_at": string | null,"equipment": (string)[],"id": string,"is_active": boolean,"kind": string,"max_vehicle_category_codes": (string)[],"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_id": string,"business_id": string,"created_at"?: string,"deleted_at"?: string | null,"equipment"?: (string)[],"id"?: string,"is_active"?: boolean,"kind"?: string,"max_vehicle_category_codes"?: (string)[],"name": string,"sort_order"?: number
                  }
                  Update: {
                    "branch_id"?: string,"business_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"equipment"?: (string)[],"id"?: string,"is_active"?: boolean,"kind"?: string,"max_vehicle_category_codes"?: (string)[],"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "workstations_business_id_branch_id_fkey"
      columns: ["business_id","branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["business_id","id"]
    }
                  ]
                }
          }
          Views: {
            "customer_consent_state": {
                  Row: {
                    "business_id": string | null,"customer_id": string | null,"granted": boolean | null,"kind": string | null,"recorded_at": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "customer_consents_business_id_customer_id_fkey"
      columns: ["business_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["business_id","id"]
    }
                  ]
                }
          }
          Functions: {
            "add_member":
{ Args: { "p_business": string,"p_role": Database["public"]['Enums']["app_role"],"p_user": string }; Returns: string
                           },
"add_work_order_item":
{ Args: { "p": Json,"p_business": string,"p_order": string }; Returns: string
                           },
"admin_create_business":
{ Args: { "p_branch_name"?: string,"p_currency"?: Database["public"]['Enums']["currency_code"],"p_locale"?: Database["public"]['Enums']["app_locale"],"p_name": string,"p_owner": string,"p_slug": string }; Returns: string
                           },
"admin_list_businesses":
{ Args: Record<PropertyKey, never>; Returns: {
              "bookings_30d": number,"branches": number,"created_at": string,"id": string,"is_active": boolean,"is_demo": boolean,"license_kind": string,"license_valid_until": string,"members": number,"modules": (string)[],"name": string,"slug": string
            }[]
                           },
"admin_set_business_active":
{ Args: { "p_active": boolean,"p_business": string }; Returns: undefined
                           },
"admin_set_license":
{ Args: { "p_business": string,"p_kind": string,"p_max_branches": number,"p_max_users": number,"p_valid_until": string }; Returns: undefined
                           },
"admin_set_module":
{ Args: { "p_business": string,"p_enabled": boolean,"p_module": Database["public"]['Enums']["module_key"] }; Returns: undefined
                           },
"analytics_summary":
{ Args: { "p_branch"?: string,"p_business": string,"p_from": string,"p_to": string }; Returns: Json
                           },
"anonymize_customer":
{ Args: { "p_business": string,"p_customer": string }; Returns: undefined
                           },
"block_time":
{ Args: { "p_branch": string,"p_business": string,"p_from": string,"p_kind": string,"p_reason": string,"p_resource": string,"p_to": string }; Returns: string
                           },
"check_in_tire_set":
{ Args: { "p": Json,"p_business": string,"p_idempotency_key"?: string }; Returns: Json
                           },
"claim_notification_jobs":
{ Args: { "p_limit"?: number,"p_worker": string }; Returns: {
              "attempts": number,
"body": string,
"business_id": string,
"campaign_id": string | null,
"channel": string,
"created_at": string,
"customer_id": string | null,
"dedupe_key": string,
"entity_id": string | null,
"entity_type": string | null,
"event": string,
"id": string,
"is_marketing": boolean,
"last_error": string | null,
"locale": Database["public"]['Enums']["app_locale"],
"locked_at": string | null,
"locked_by": string | null,
"max_attempts": number,
"provider_message_id": string | null,
"recipient": string,
"run_at": string,
"sent_at": string | null,
"status": string,
"subject": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "notification_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"complete_notification_job":
{ Args: { "p_detail"?: string,"p_job": string,"p_message_id"?: string,"p_ok": boolean,"p_provider": string,"p_retryable"?: boolean }; Returns: undefined
                           },
"create_booking":
{ Args: { "p": Json,"p_business": string,"p_idempotency_key"?: string }; Returns: string
                           },
"create_storage_grid":
{ Args: { "p_business": string,"p_capacity"?: number,"p_cells": number,"p_racks": number,"p_shelves": number,"p_warehouse": string,"p_zone": string }; Returns: number
                           },
"create_work_order":
{ Args: { "p": Json,"p_business": string,"p_idempotency_key"?: string }; Returns: string
                           },
"dashboard_stats":
{ Args: { "p_branch"?: string,"p_business": string }; Returns: Json
                           },
"decide_additional_work":
{ Args: { "p_approved": boolean,"p_business": string,"p_item": string }; Returns: undefined
                           },
"export_customer":
{ Args: { "p_business": string,"p_customer": string }; Returns: Json
                           },
"extend_storage":
{ Args: { "p_business": string,"p_ends_on": string,"p_price": number,"p_set": string }; Returns: string
                           },
"find_slots":
{ Args: { "p_branch": string,"p_business": string,"p_day": string,"p_params"?: Json,"p_services": (string)[] }; Returns: {
              "starts_at": string,"workstation_id": string
            }[]
                           },
"has_perm":
{ Args: { "p_business": string,"p_perm": string }; Returns: boolean
                           },
"is_member":
{ Args: { "p_business": string }; Returns: boolean
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"merge_customers":
{ Args: { "p_business": string,"p_keep": string,"p_merge": string }; Returns: undefined
                           },
"module_enabled":
{ Args: { "p_business": string,"p_module": Database["public"]['Enums']["module_key"] }; Returns: boolean
                           },
"move_tire_set":
{ Args: { "p_business": string,"p_location": string,"p_note"?: string,"p_set": string }; Returns: undefined
                           },
"my_permissions":
{ Args: { "p_business": string }; Returns: (string)[]
                           },
"my_work":
{ Args: { "p_business": string }; Returns: Json
                           },
"public_booking":
{ Args: { "p_token": string }; Returns: Json
                           },
"public_business":
{ Args: { "p_slug": string }; Returns: Json
                           },
"public_cancel_booking":
{ Args: { "p_token": string }; Returns: undefined
                           },
"public_create_booking":
{ Args: { "p": Json,"p_slug": string }; Returns: Json
                           },
"public_quote":
{ Args: { "p_params": Json,"p_services": (string)[],"p_slug": string }; Returns: Json
                           },
"public_reschedule_booking":
{ Args: { "p_starts_at": string,"p_token": string }; Returns: undefined
                           },
"public_slots":
{ Args: { "p_branch": string,"p_day": string,"p_params": Json,"p_services": (string)[],"p_slug": string }; Returns: {
              "starts_at": string
            }[]
                           },
"quote_service":
{ Args: { "p_business": string,"p_params": Json,"p_service": string }; Returns: {
              "duration_min": number,"line_total": number,"quantity": number,"service_id": string,"tax_rate_bp": number,"unit_price": number
            }[]
                           },
"quote_services":
{ Args: { "p_business": string,"p_params": Json,"p_services": (string)[] }; Returns: Json
                           },
"record_inventory_movement":
{ Args: { "p_business": string,"p_kind": string,"p_note"?: string,"p_product": string,"p_quantity": number,"p_unit_cost"?: number,"p_warehouse": string }; Returns: string
                           },
"record_payment":
{ Args: { "p_amount": number,"p_business": string,"p_idempotency_key"?: string,"p_method": string,"p_order": string,"p_reference"?: string }; Returns: string
                           },
"record_storage_payment":
{ Args: { "p_amount": number,"p_business": string,"p_contract": string,"p_method": string }; Returns: string
                           },
"refund_payment":
{ Args: { "p_amount": number,"p_business": string,"p_idempotency_key"?: string,"p_payment": string,"p_reason": string }; Returns: string
                           },
"release_tire_set":
{ Args: { "p_allow_unpaid"?: boolean,"p_business": string,"p_note"?: string,"p_set": string }; Returns: undefined
                           },
"remove_work_order_item":
{ Args: { "p_business": string,"p_item": string }; Returns: undefined
                           },
"reschedule_booking":
{ Args: { "p_booking": string,"p_business": string,"p_clear_employee"?: boolean,"p_duration_min"?: number,"p_employee"?: string,"p_starts_at": string,"p_workstation"?: string }; Returns: undefined
                           },
"schedule_periodic_notifications":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"search_customers":
{ Args: { "p_business": string,"p_limit"?: number,"p_query": string }; Returns: {
              "email": string,"first_name": string,"id": string,"last_name": string,"last_visit_at": string,"phone": string,"plates": (string)[]
            }[]
                           },
"set_booking_status":
{ Args: { "p_booking": string,"p_business": string,"p_reason"?: string,"p_status": Database["public"]['Enums']["booking_status"] }; Returns: undefined
                           },
"set_work_order_status":
{ Args: { "p_business": string,"p_note"?: string,"p_order": string,"p_status": Database["public"]['Enums']["work_order_status"] }; Returns: undefined
                           },
"transfer_stock":
{ Args: { "p_business": string,"p_from": string,"p_note"?: string,"p_product": string,"p_quantity": number,"p_to": string }; Returns: string
                           },
"update_work_notes":
{ Args: { "p_business": string,"p_damage": string,"p_mileage"?: number,"p_note": string,"p_order": string }; Returns: undefined
                           }
          }
          Enums: {
            "app_locale": "cs"|"pl"|"uk"|"sk"|"de"|"en"|"ru","app_role": "owner"|"manager"|"mechanic"|"accountant","booking_status": "pending"|"confirmed"|"arrived"|"in_progress"|"completed"|"cancelled"|"no_show","currency_code": "CZK"|"EUR"|"PLN"|"UAH","module_key": "calendar"|"orders"|"customers"|"vehicles"|"tire_hotel"|"inventory"|"services"|"employees"|"finance"|"analytics"|"notifications"|"corporate"|"online_booking"|"ai_assistant","payment_status": "unpaid"|"partial"|"paid"|"refunded"|"overpaid","work_order_status": "draft"|"scheduled"|"in_progress"|"awaiting_approval"|"ready"|"completed"|"cancelled"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_locale": ["cs", "pl", "uk", "sk", "de", "en", "ru"],"app_role": ["owner", "manager", "mechanic", "accountant"],"booking_status": ["pending", "confirmed", "arrived", "in_progress", "completed", "cancelled", "no_show"],"currency_code": ["CZK", "EUR", "PLN", "UAH"],"module_key": ["calendar", "orders", "customers", "vehicles", "tire_hotel", "inventory", "services", "employees", "finance", "analytics", "notifications", "corporate", "online_booking", "ai_assistant"],"payment_status": ["unpaid", "partial", "paid", "refunded", "overpaid"],"work_order_status": ["draft", "scheduled", "in_progress", "awaiting_approval", "ready", "completed", "cancelled"]
          }
        }
} as const
