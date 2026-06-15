// ================================================================
// CONFIGURACIÓN ANALYTICS — El Inter FC
// ================================================================
// 1. Creá un proyecto en https://console.firebase.google.com
//    → Realtime Database → Crear base de datos → Modo prueba
//    → Configuración del proyecto → Agregar app web → Copiá los valores
//
// 2. Creá una propiedad en https://analytics.google.com
//    → Nuevo → Web → copiá el ID que empieza con G-
// ================================================================

window.FIREBASE_CONFIG = {
  apiKey:            "REEMPLAZAR_apiKey",
  authDomain:        "REEMPLAZAR_project.firebaseapp.com",
  databaseURL:       "https://REEMPLAZAR_project-default-rtdb.firebaseio.com",
  projectId:         "REEMPLAZAR_project",
  storageBucket:     "REEMPLAZAR_project.appspot.com",
  messagingSenderId: "REEMPLAZAR_senderId",
  appId:             "REEMPLAZAR_appId"
};

window.GA4_ID = "G-XXXXXXXXXX";
