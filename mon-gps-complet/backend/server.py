from flask import Flask, jsonify
from flask_cors import CORS
import sqlite3

app = Flask(__name__)
# On autorise le frontend à faire des requêtes vers cette API
CORS(app)

def get_db_connection():
    conn = sqlite3.connect('radars.db')
    # Permet de récupérer les résultats sous forme de dictionnaire (clé: valeur)
    conn.row_factory = sqlite3.Row
    return conn

# On crée une route (une URL) pour récupérer les radars
@app.route('/api/radars', methods=['GET'])
def get_radars():
    conn = get_db_connection()
    cursor = conn.cursor()
    # On va chercher tous les radars dans la table SQL
    cursor.execute('SELECT * FROM radars')
    radars = cursor.fetchall()
    conn.close()
    
    # On transforme les résultats en liste classique
    radars_list = [dict(ix) for ix in radars]
    
    # On renvoie les données au format JSON
    return jsonify(radars_list)

import os

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)