#!/usr/bin/env node
/** Bulk-fix known-broken marketing image URLs (Wikimedia thumb sizes + path mismatches). */
const fs = require("fs");
const path = require("path");

const MARKETING_DIR = path.join(__dirname, "..", "client", "marketing");

const REPLACEMENTS = [
  ["/1200px-Mexico_City_Skyline_%285604867225%29.jpg", "/1280px-Mexico_City_Skyline_%285604867225%29.jpg"],
  ["/2000px-Mexico_City_Skyline_%285604867225%29.jpg", "/1920px-Mexico_City_Skyline_%285604867225%29.jpg"],
  ["/900px-Palacio_de_Bellas_Artes%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-13%2C_DD_41.jpg", "/960px-Palacio_de_Bellas_Artes%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-13%2C_DD_41.jpg"],
  ["960px-Seine_and_Eiffel_Tower_from_Tour_Montparnasse%2C_Paris_July_2014.jpg", "960px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg"],
  ["1920px-Seine_and_Eiffel_Tower_from_Tour_Montparnasse%2C_Paris_July_2014.jpg", "1920px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg"],
  ["960px-View_of_Louvre_from_Jardin_des_Tuileries%2C_Paris_22_June_2014.jpg", "960px-Notre-Dame_de_Paris%2C_4_October_2017.jpg"],
  ["1400px-View_of_Louvre_from_Jardin_des_Tuileries%2C_Paris_22_June_2014.jpg", "1280px-Notre-Dame_de_Paris%2C_4_October_2017.jpg"],
  ["/640px-Paris_metro_sign.jpg", "/960px-Paris_metro_sign.jpg"],
  ["/2000px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg", "/1920px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg"],
  ["/480px-Fuente_Mujer_Con_Flores_-_Alameda_Central_-_Mexico_2024_%282%29.jpg", "/960px-Fuente_Mujer_Con_Flores_-_Alameda_Central_-_Mexico_2024_%282%29.jpg"],
  ["/480px-Alameda_Central_-_Mexico_2024.jpg", "/960px-Alameda_Central_-_Mexico_2024.jpg"],
  ["/480px-Hotel_Geneve%2C_Mexico_D.F._-_panoramio_%281%29.jpg", "/960px-Hotel_Geneve%2C_Mexico_D.F._-_panoramio_%281%29.jpg"],
  [
    "thumb/b/bc/Palacio_Postal%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-16%2C_DD_49.JPG/1400px-Palacio_Postal%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-16%2C_DD_49.JPG",
    "thumb/8/81/Palacio_Postal%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-16%2C_DD_59.JPG/1280px-Palacio_Postal%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2013-10-16%2C_DD_59.JPG",
  ],
  [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Paris_-_Avenue_des_Champs-%C3%89lys%C3%A9es_-_2016.jpg/960px-Paris_-_Avenue_des_Champs-%C3%89lys%C3%A9es_-_2016.jpg",
    "https://images.unsplash.com/photo-1579027989536-b7b1f875659b?auto=format&amp;fit=crop&amp;w=960&amp;q=82",
  ],
  [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Mexico_City_%282018%29_-_302.jpg/480px-Mexico_City_%282018%29_-_302.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Casa_de_los_Azulejos%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2014-10-13%2C_DD_47.JPG/960px-Casa_de_los_Azulejos%2C_M%C3%A9xico_D.F.%2C_M%C3%A9xico%2C_2014-10-13%2C_DD_47.JPG",
  ],
];

const files = fs.readdirSync(MARKETING_DIR).filter((f) => f.endsWith(".html"));
let total = 0;
for (const f of files) {
  const fp = path.join(MARKETING_DIR, f);
  let html = fs.readFileSync(fp, "utf8");
  let n = 0;
  for (const [from, to] of REPLACEMENTS) {
    const before = html;
    html = html.split(from).join(to);
    if (html !== before) n++;
  }
  if (n) {
    fs.writeFileSync(fp, html);
    console.log(f, n, "replacement groups");
    total += n;
  }
}
console.log("done:", total, "replacement groups across", files.length, "pages");
