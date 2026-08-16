import sqlite3
import urllib.request
import json

# Exemple de script pour rafraîchir ou synchroniser tes données de radars
def update_radars_database():
    print("Connexion à la base de données SQLite...")
    conn = sqlite3.connect('radars.db')
    cursor = conn.cursor()

    # S'assure que la table existe
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS radars (
            id TEXT PRIMARY KEY,
            type TEXT,
            date_mise_en_service TEXT,
            vitesse_limite TEXT,
            lat TEXT,
            lon TEXT
        )
    ''')

    # Ici, tu pourrais intégrer ta source de données fraîche (API officielle, fichier JSON, etc.)
    print("Base de données prête et à jour !")
    
    conn.commit()
    conn.close()

if __name__ == '__main__':
    update_radars_database()