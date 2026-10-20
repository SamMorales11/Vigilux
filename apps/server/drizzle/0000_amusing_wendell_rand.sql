CREATE TABLE "anomaly_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" varchar(50) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"anomaly_score" double precision NOT NULL,
	"waste_kw" double precision NOT NULL,
	"estimated_cost_per_hr" double precision NOT NULL,
	"diagnostic_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_registry" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"rated_kw" double precision NOT NULL,
	"iso_vibration_limit" double precision NOT NULL,
	"status" varchar(50) DEFAULT 'operational' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" varchar(50) NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"kw" double precision NOT NULL,
	"rpm" double precision NOT NULL,
	"bearing_temp" double precision NOT NULL,
	"vibration_rms" double precision NOT NULL,
	"pressure" double precision NOT NULL,
	"predicted_kw" double precision,
	"waste_gap_kw" double precision,
	"anomaly_score" double precision
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "anomaly_incidents" ADD CONSTRAINT "anomaly_incidents_asset_id_asset_registry_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_telemetry" ADD CONSTRAINT "sensor_telemetry_asset_id_asset_registry_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anomaly_incidents_asset_id_idx" ON "anomaly_incidents" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "anomaly_incidents_timestamp_idx" ON "anomaly_incidents" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "sensor_telemetry_asset_id_idx" ON "sensor_telemetry" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "sensor_telemetry_timestamp_idx" ON "sensor_telemetry" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "sensor_telemetry_timestamp_brin_idx" ON "sensor_telemetry" USING brin ("timestamp");--> statement-breakpoint
CREATE INDEX "sensor_telemetry_asset_time_idx" ON "sensor_telemetry" USING btree ("asset_id","timestamp");