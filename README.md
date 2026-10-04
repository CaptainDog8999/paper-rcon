# Paper RCON Link

The page signs in with Google and loads that account's saved server presets. Send uses a Netlify function, which opens the Playit TCP tunnel and speaks RCON.

Set `GOOGLE_CLIENT_ID` in the Netlify site environment, then redeploy. The client ID is a Google web client whose authorized origin is the Netlify site address.
