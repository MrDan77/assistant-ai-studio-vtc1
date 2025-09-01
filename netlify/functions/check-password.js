// Questo codice viene eseguito in modo sicuro sui server di Netlify.

// Legge la password corretta dalle "Variabili d'Ambiente" sicure di Netlify.
// La password non è mai scritta direttamente nel codice.
const CORRECT_PASSWORD = process.env.SITE_PASSWORD;

exports.handler = async function(event, context) {
    // Per sicurezza, accettiamo solo richieste di tipo "POST" (quelle inviate da un modulo).
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Estrae la password che l'utente ha inserito nel modulo sulla pagina web.
        const { password } = JSON.parse(event.body);

        // Confronta la password inviata dall'utente con quella corretta e segreta.
        if (password === CORRECT_PASSWORD) {
            // Se le password corrispondono, invia una risposta di successo.
            return {
                statusCode: 200, // Codice "OK"
                body: JSON.stringify({ message: 'Success' })
            };
        } else {
            // Se le password NON corrispondono, invia una risposta di errore.
            return {
                statusCode: 401, // Codice "Non autorizzato"
                body: JSON.stringify({ message: 'Invalid password' })
            };
        }
    } catch (error) {
        // In caso di un errore imprevisto, invia una risposta generica.
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};