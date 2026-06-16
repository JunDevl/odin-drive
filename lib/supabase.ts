import "dotenv/config";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env["SUPABASE_URL"]!, 
  process.env["SUPABASE_PUBLISHABLE_KEY"]!
)

export default supabase;

// supabase.storage.from("drives").upload("bd2b466c-9949-471f-a7e2-14062bf0bcad")
//   .then(res => console.log(res));