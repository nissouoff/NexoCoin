const express = require('express');
const admin = require('firebase-admin');
const NodeCache = require('node-cache');

// Initialisation de Firebase Admin
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://infofoot-32892-default-rtdb.firebaseio.com'
});

const app = express();
const db = admin.database();
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); // Cache avec TTL de 60s

// Middleware
app.use(express.json({ limit: '10kb' }));

// Constants
const PORT = process.env.PORT || 3000;

// Fonction pour gérer le minage toutes les 5 secondes
const manageMining = async () => {
    try {
        const miningStartSnapshot = await db.ref('MiningStart').once('value');
        const miningStartData = miningStartSnapshot.val() || {};
        const now = Date.now();

        for (const userId in miningStartData) {
            const userData = miningStartData[userId];
            const nextMining = userData.next || 0;
            const total = userData.total || 0;
            const totalS = userData.totalS || 0;

            const miningRef = db.ref(`Users/${userId}/mining/`);
            const miningSnapshot = await miningRef.once('value');
            const miningData = miningSnapshot.val() || {};
            let currentNxo = miningData.NXO || 0;

            if (now >= nextMining) {
                console.log(`Minage terminé pour ${userId}`);
                await db.ref(`MiningStart/${userId}`).update({ minage: 'off' });

                if (total !== currentNxo) {
                    const difference = total - currentNxo;
                    if (difference > 0) {
                        currentNxo += difference;
                        await miningRef.update({ NXO: currentNxo });
                        console.log(`NXO ajusté pour ${userId} : ${currentNxo}`);
                    }
                }
                await db.ref(`MiningStart/${userId}`).remove();
                console.log(`Entrée MiningStart/${userId} supprimée`);
            } else {
                console.log(`Mise à jour NXO pour ${userId}`);
                const gainPerInterval = totalS / (3600 / 5); // Gain toutes les 5 secondes
                currentNxo += gainPerInterval;
                await miningRef.update({ NXO: currentNxo });
                console.log(`NXO mis à jour pour ${userId} : ${currentNxo}`);
                cache.del(`mining_${userId}`);
            }
        }
    } catch (error) {
        console.error('Erreur dans manageMining :', error);
    }
};

// Démarrer la gestion du minage toutes les 5 secondes
setInterval(manageMining, 5000);

// Route simple pour répondre aux pings (éviter la mise en veille)
app.get('/ping', (req, res) => {
    res.json({ success: true, message: 'Server is alive' });
});

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});

// Gestion des erreurs globales
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});