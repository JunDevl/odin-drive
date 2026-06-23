import "dotenv/config";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env["SUPABASE_URL"]!, 
  process.env["SUPABASE_PUBLISHABLE_KEY"]!
)

export default supabase;

supabase.storage.from("drives").copy("bd2b466c-9949-471f-a7e2-14062bf0bcad/ATA Casamento Vanessa e Estevam.docx.pdf", "bd2b466c-9949-471f-a7e2-14062bf0bcad/oof/ATA Casamento Vanessa e Estevam.docx.pdf")
  .then(res => console.log(res));