import sqlite3
import json
import urllib.request

# URL de ton Gist actuel pour récupérer les données de base
GIST_URL = "https://gist.githubusercontent.com/gregorylaporte1810-gif/9b4eeb6c715a0bcde5644ad236d8d3f9/raw/bbe7399262869585ce05578e7d07aceaf0934f55/radars.json"

def init_db():
    # Connexion à la base de données (le fichier sera créé automatiquement s'il n'existe pas)
    conn = sqlite3.connect('radars.db')
    cursor = conn.cursor()

    # Création de la table SQL avec les bonnes colonnes
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS radars (
            id TEXT PRIMARY KEY,
            type TEXT,
            date_mise_en_service TEXT,
            vitesse_limite TEXT,
            lat REAL,
            lon REAL
        )
    ''')

    print("Table SQL 'radars' créée avec succès.")

    # Optionnel : On télécharge ton JSON actuel pour remplir la base SQL d'un coup
    print("Téléchargement des radars existants depuis le Gist...")
    with urllib.request.urlopen(GIST_URL) as url:
        data = json.loads(url.read().decode())
        
        for item in data:
            try:
                # Nettoyage des clés qui ont parfois des espaces dans le JSON
                lat_key = next(k for k in item.keys() if k.strip() == "Latitude")
                lon_key = next(k for k in item.keys() if k.strip() == "Longitude")
                num_key = next(k for k in item.keys() if k.strip() == "Numéro de radar")
                type_key = next(k for k in item.keys() if k.strip() == "Type de radar")
                date_key = next(k for k in item.keys() if k.strip() == "Date de mise en service")
                vma_key = next(k for k in item.keys() if k.strip() == "VMA")

                lat = float(str(item.get(lat_key, "")).strip().replace("+", ""))
                lon = float(str(item.get(lon_key, "")).strip().replace("+", ""))
                
                cursor.execute('''
                    INSERT OR IGNORE INTO radars (id, type, date_mise_en_service, vitesse_limite, lat, lon)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (item[num_key], item[type_key], item[date_key], str(item[vma_key]), lat, lon))
            except Exception as e:
                pass # On ignore les lignes mal formatées

    conn.commit()
    conn.close()
    print("Base de données initialisée et remplie avec succès !")

if __name__ == '__main__':
    init_db()