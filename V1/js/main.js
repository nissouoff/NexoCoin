// Firebase config et initialisation
const firebaseConfig = {
    apiKey: "AIzaSyAdo42qfCCYjwvdi5_JthsrDXxcRIxsbE0",
    authDomain: "infofoot-32892.firebaseapp.com",
    databaseURL: "https://infofoot-32892-default-rtdb.firebaseio.com",
    projectId: "infofoot-32892",
    storageBucket: "infofoot-32892.appspot.com",
    messagingSenderId: "439273116379",
    appId: "1:439273116379:web:9eb86071e411f748c772fe"
};

// Initialisation Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

// FRONTEND: main.js
document.addEventListener("DOMContentLoaded", async () => {
    // Sélection des éléments DOM une seule fois
    const elements = {
        miningButton: document.querySelector(".mining-button"),
        progressMask: document.querySelector(".progress-mask"),
        timeerTxt: document.getElementById("timeer-txt"),
        timeeTxt: document.getElementById("timee-txt"),
        recolttTxt: document.getElementById("recoltt-txt"),
        bonussTxt: document.getElementById("bonuss-txt"),
        overlay1: document.getElementById("overlay1"),
        tokennTxt: document.getElementById("tokenn-txt"),
        carte1: document.getElementById("carte1"),
        carte2: document.getElementById("carte2"),
        carte3: document.getElementById("carte3")
    };

    let userId = null;
    let token = null;
    let progressInterval = null;
    const BASE_URL = 'http://localhost:3000'; // À remplacer par votre URL en production

    // Fonction utilitaire pour fetch avec token
    const fetchWithAuth = async (url, options = {}) => {
        const response = await fetch(`${BASE_URL}${url}`, {
            ...options,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Erreur réseau');
        return response.json();
    };

    // Formater le temps restant en MM:SS
    function formatTimeRemaining(nextMining) {
        const now = Date.now();
        const timeLeft = Math.max(0, nextMining - now); // Temps restant en millisecondes
        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // Fonction pour maintenir l'activité
    function keepAlive() {
        if (!userId || !token) return;

        fetchWithAuth('/keep-alive')
            .then(response => {
                console.log('Keep-alive envoyé:', response);
            })
            .catch(error => {
                console.error('Erreur keep-alive:', error);
            });
    }

    // Initialisation avec Firebase Auth (un seul bloc)
    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) return;

        userId = user.uid;
        token = await user.getIdToken();
        console.log('Utilisateur connecté :', userId); // Log pour vérification

        try {
            const { miningData } = await fetchWithAuth(`/mining-data/${userId}`);
            const { 'last-mining': lastMining, 'next-mining': nextMining, NXO: nxo, 'puissance-mining': puissance, bonus } = miningData;
            const now = Date.now();

            console.log('Données au chargement:', { lastMining, nextMining, nxo, now });

            // Toujours afficher last-mining s’il existe
            elements.timeerTxt.textContent = lastMining ? new Date(lastMining).toLocaleString() : 'N/A';

            // Afficher next-mining ou "Available"
            if (now < nextMining) {
                elements.timeeTxt.textContent = new Date(nextMining).toLocaleString();
                elements.miningButton.textContent = formatTimeRemaining(nextMining); // Minuteur au lieu de "Mining..."
                elements.miningButton.disabled = true;
                startProgress(lastMining, nextMining);
            } else {
                elements.timeeTxt.textContent = 'Available';
                if (nxo > 0) {
                    elements.miningButton.textContent = "Collect";
                    elements.miningButton.disabled = false;
                    elements.miningButton.onclick = () => collectNxo();
                } else {
                    elements.miningButton.textContent = "Start Mining";
                    elements.miningButton.disabled = false;
                    elements.miningButton.onclick = () => startMining();
                }
            }

            // Afficher la valeur réelle de NXO au chargement
            elements.tokennTxt.textContent = `${nxo} NXO`;
            elements.recolttTxt.textContent = `+${puissance} NXO/h`;
            elements.bonussTxt.textContent = `+${bonus} NXO/h`;

            // Appeler keepAlive après initialisation
            keepAlive();

        } catch (error) {
            console.error('Erreur initialisation:', error);
            elements.miningButton.textContent = "Erreur";
            elements.miningButton.disabled = true;
        }
    });

    // Envoyer une requête toutes les 24 heures
    const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
    setInterval(keepAlive, ONE_DAY_MS);

    // Démarrer le minage
    async function startMining() {
        try {
            elements.overlay1.style.display = "flex";
            const response = await fetchWithAuth(`/start-mining/${userId}`, { method: 'POST' });
            const { 'last-mining': lastMining, 'next-mining': nextMining } = response;

            console.log('Réponse de start-mining:', { lastMining, nextMining });

            // Vérifier que les valeurs sont valides avant de les utiliser
            if (!lastMining || !nextMining || isNaN(lastMining) || isNaN(nextMining)) {
                throw new Error('Dates de minage invalides renvoyées par le serveur');
            }

            elements.timeerTxt.textContent = new Date(lastMining).toLocaleString();
            elements.timeeTxt.textContent = new Date(nextMining).toLocaleString();
            elements.miningButton.textContent = formatTimeRemaining(nextMining); // Minuteur au lieu de "Mining..."
            elements.miningButton.disabled = true;

            startProgress(lastMining, nextMining);

            // Mettre à jour NXO après démarrage
            const { miningData } = await fetchWithAuth(`/mining-data/${userId}`);
            elements.tokennTxt.textContent = `${miningData.NXO} NXO`;

            setTimeout(() => {
                elements.overlay1.style.display = "none";
            }, 3000);
        } catch (error) {
            console.error('Erreur démarrage minage:', error);
            alert(error.message);
            elements.overlay1.style.display = "none";
        }
    }

    // Collecter les NXO
    async function collectNxo() {
        try {
            const response = await fetchWithAuth(`/collect-nxo/${userId}`, { method: 'POST' });
            console.log('Réponse complète du backend:', response);

            const updatedNxoCoin = response.updatedNxoCoin;
            if (typeof updatedNxoCoin === 'undefined') {
                throw new Error('updatedNxoCoin non renvoyé par le backend');
            }
            console.log(`Collected NXO, new total: ${updatedNxoCoin}`);

            elements.tokennTxt.textContent = `0 NXO`;
            elements.miningButton.textContent = "Start Mining";
            elements.miningButton.disabled = false;
            elements.miningButton.onclick = () => startMining();

            // Mettre à jour les champs après collecte
            const { miningData } = await fetchWithAuth(`/mining-data/${userId}`);
            elements.timeerTxt.textContent = miningData['last-mining'] ? new Date(miningData['last-mining']).toLocaleString() : 'N/A';
            elements.timeeTxt.textContent = 'Available';
        } catch (error) {
            console.error('Erreur collecte NXO:', error);
            alert(error.message);
        }
    }

    // Mettre à jour la barre de progression et le minuteur
    function updateProgressBar(lastMining, nextMining) {
        const now = Date.now();
        if (now >= nextMining) {
            elements.progressMask.style.background = "none";
            elements.miningButton.disabled = false;
            elements.miningButton.textContent = "Collect";
            elements.miningButton.onclick = () => collectNxo();
            elements.timeeTxt.textContent = 'Available';
            clearInterval(progressInterval);
            progressInterval = null;
        } else {
            const progress = ((now - lastMining) / (nextMining - lastMining)) * 100;
            const degrees = (progress / 100) * 360;
            elements.progressMask.style.background = `conic-gradient(#1500f9 ${degrees}deg, transparent 0%)`;
            elements.miningButton.textContent = formatTimeRemaining(nextMining); // Mettre à jour le minuteur
            elements.timeeTxt.textContent = new Date(nextMining).toLocaleString();
        }
    }

    // Démarrer ou reprendre la progression en temps réel
    function startProgress(lastMining, nextMining) {
        updateProgressBar(lastMining, nextMining);
        if (!progressInterval) {
            progressInterval = setInterval(() => updateProgressBar(lastMining, nextMining), 1000);
        }
    }
});