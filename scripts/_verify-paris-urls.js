#!/usr/bin/env node
const urls = [
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Paris_metro_sign.jpg/960px-Paris_metro_sign.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Paris_-_Rue_Mouffetard_-_2016.jpg/960px-Paris_-_Rue_Mouffetard_-_2016.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/View_of_Louvre_from_Jardin_des_Tuileries%2C_Paris_22_June_2014.jpg/960px-View_of_Louvre_from_Jardin_des_Tuileries%2C_Paris_22_June_2014.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Seine_and_Eiffel_Tower_from_Tour_Montparnasse%2C_Paris_July_2014.jpg/1920px-Seine_and_Eiffel_Tower_from_Tour_Montparnasse%2C_Paris_July_2014.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Paris_-_Pont_des_Arts_-_2016.jpg/960px-Paris_-_Pont_des_Arts_-_2016.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Notre-Dame_de_Paris%2C_4_October_2017.jpg/960px-Notre-Dame_de_Paris%2C_4_October_2017.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Paris_-_Avenue_des_Champs-%C3%89lys%C3%A9es_-_2016.jpg/960px-Paris_-_Avenue_des_Champs-%C3%89lys%C3%A9es_-_2016.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Montmartre_-_Sacr%C3%A9-C%C5%93ur_01.jpg/960px-Montmartre_-_Sacr%C3%A9-C%C5%93ur_01.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Le_Marais%2C_Paris%2C_France_-_panoramio.jpg/960px-Le_Marais%2C_Paris%2C_France_-_panoramio.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/960px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg",
];

(async () => {
  let bad = 0;
  for (const u of urls) {
    await new Promise((r) => setTimeout(r, 600));
    const st = (await fetch(u, { headers: { "User-Agent": "RoomMatch/1.0" } })).status;
    if (st < 200 || st >= 400) bad++;
    console.log(st, u.slice(50, 110));
  }
  process.exit(bad ? 1 : 0);
})();
