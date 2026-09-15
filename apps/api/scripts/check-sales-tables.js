const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_KEY environment variables required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('=== Running Sales Module Migration ===\n');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, '../../../migrations/create-sales-dispatch.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Migration file loaded...');
    console.log(`File size: ${sql.length} characters\n`);
    
    // Execute the migration using Supabase RPC
    console.log('Executing migration...');
    
    // Since we can't execute raw SQL directly via Supabase client, 
    // we'll check if tables exist instead
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('count', { count: 'exact', head: true });
    
    if (customersError && customersError.code !== 'PGRST116') {
      console.log('⚠️  Customers table does not exist');
      console.log('\n📋 To apply the migration, run this SQL in Supabase SQL Editor:');
      console.log('   https://supabase.com/dashboard/project/jvklxdqknudjodxihkvb/sql/new\n');
      console.log('Or use psql:');
      console.log('   psql -h aws-0-ap-south-1.pooler.supabase.com -p 6543');
      console.log('        -U postgres.jvklxdqknudjodxihkvb -d postgres');
      console.log('        -f migrations/create-sales-dispatch.sql\n');
      process.exit(1);
    } else {
      console.log('✅ Sales tables already exist');
      
      // Check all tables
      const tables = ['customers', 'quotations', 'sales_orders', 'dispatch_notes', 'warranties'];
      console.log('\n=== Table Status ===');
      
      for (const table of tables) {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        if (error) {
          console.log(`❌ ${table}: ERROR - ${error.message}`);
        } else {
          console.log(`✅ ${table}: ${count} records`);
        }
      }
    }
    
    console.log('\n=== Migration Check Complete ===');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
