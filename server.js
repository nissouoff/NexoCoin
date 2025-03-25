const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
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
const auth = admin.auth();
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); // Cache avec TTL de 60s

// Middleware
app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: true, methods: ['GET', 'POST'] }));

// Constants
const MINING_DURATION = 3 * 60 * 60 * 1000; // 3 heures en ms
const PORT = process.env.PORT || 3000;

// Middleware d'authentification
const authenticateUser = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'No token provided' });

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        req.userId = decodedToken.uid;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Fonctions utilitaires
const getUserData = async (refPath, cacheKey) => {
    const cachedData = cache.get(cacheKey);
    if (cachedData) return cachedData;

    const snapshot = await db.ref(refPath).once('value');
    const data = snapshot.val() || {};
    cache.set(cacheKey, data);
    return data;
};

// Routes API
app.post('/signup', async (req, res) => {
    const { name, username, email, password } = req.body;
    if (!name || !username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Tous les champs sont requis' });
    }

    try {
        const usersSnapshot = await db.ref('Users').once('value');
        if (usersSnapshot.exists() && Object.values(usersSnapshot.val()).some(user => user.perso?.username === username)) {
            return res.status(409).json({ success: false, message: 'Nom d’utilisateur déjà pris' });
        }

        const userRecord = await auth.createUser({ email, password, displayName: name });
        const refKey = userRecord.uid;

        await Promise.all([
            db.ref(`Users/${refKey}/perso/`).set({ name, username, email, NexoCoin: 0, Caret: 1 }),
            db.ref(`Users/${refKey}/mining/`).set({ NXO: 0, 'last-mining': 0, 'next-mining': 0, 'puissance-mining': 0.3, bonus: 0, carte: 1 }),
            db.ref(`Users/${refKey}/cards/`).push().set({ name: 'Nxo-Miner V1', energie: 3, puissance: 0.3, active: 0, bonus: 0 })
        ]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/login', async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Identifiant et mot de passe requis' });
    }

    try {
        let email = identifier;
        if (!identifier.includes('@')) {
            const usersSnapshot = await db.ref('Users').once('value');
            const users = usersSnapshot.val();
            email = Object.values(users).find(user => user.perso?.username === identifier)?.perso?.email;
            if (!email) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        await auth.getUserByEmail(email);
        res.json({ success: true, email });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }
});

app.get('/mining-data/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const miningData = await getUserData(`Users/${userId}/mining/`, `mining_${userId}`);
        res.json({ success: true, miningData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/start-mining/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    if (userId !== req.userId) return res.status(403).json({ error: 'Unauthorized' });

    const miningRef = db.ref(`Users/${userId}/mining/`);
    const miningStartRef = db.ref(`MiningStart/${userId}`);

    try {
        const miningSnapshot = await miningRef.once('value');
        const miningData = miningSnapshot.val() || {};
        const now = Date.now();
        const nextMiningDuration = 3600 * 1000; // 1 heure

        if (miningData['next-mining'] && now < miningData['next-mining']) {
            return res.status(400).json({ error: 'Minage déjà en cours' });
        }

        const puissanceMining = miningData['puissance-mining'] || 0.3;
        const bonus = miningData.bonus || 0;
        const total = puissanceMining + bonus;
        const intervalSeconds = 5;
        const totalIntervals = 3600 / intervalSeconds;
        const gainPerInterval = total / (3600 / intervalSeconds);
        const totalS = gainPerInterval * totalIntervals;

        await miningStartRef.set({
            total: total,
            totalS: totalS,
            next: now + nextMiningDuration
        });

        const newMiningData = {
            'last-mining': now,
            'next-mining': now + nextMiningDuration,
            NXO: 0,
            'puissance-mining': puissanceMining,
            bonus: bonus,
            carte: miningData.carte || 1
        };

        await miningRef.set(newMiningData);
        cache.del(`mining_${userId}`);

        res.json({
            success: true,
            'last-mining': newMiningData['last-mining'],
            'next-mining': newMiningData['next-mining']
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/collect-nxo/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    if (userId !== req.userId) return res.status(403).json({ error: 'Unauthorized' });

    const miningRef = db.ref(`Users/${userId}/mining/`);
    const persoRef = db.ref(`Users/${userId}/perso/`);

    try {
        const miningSnapshot = await miningRef.once('value');
        const miningData = miningSnapshot.val() || {};
        const nxo = miningData.NXO || 0;

        if (nxo <= 0) return res.status(400).json({ error: 'Aucun NXO à collecter' });

        const persoSnapshot = await persoRef.once('value');
        const persoData = persoSnapshot.val() || {};
        const currentNxoCoin = persoData.NexoCoin || 0;

        const updatedNxoCoin = currentNxoCoin + nxo;
        await persoRef.update({ NexoCoin: updatedNxoCoin });
        await miningRef.update({ NXO: 0 });

        cache.del(`mining_${userId}`);
        cache.del(`perso_${userId}`);

        res.json({
            success: true,
            message: 'NXO collecté',
            updatedNxoCoin: updatedNxoCoin
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Gestion du minage automatique
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
                const gainPerInterval = totalS / (3600 / 5);
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

// Exécuter manageMining toutes les 5 secondes
setInterval(manageMining, 5000);

// Route pour ping (garder le serveur éveillé)
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