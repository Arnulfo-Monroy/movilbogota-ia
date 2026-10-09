# Pruebas manuales realizadas — MovilBogotá IA

Registro descriptivo de una sesión de pruebas locales del **8 y 9 de octubre de 2026**. Los resultados se observaron en la interfaz y en la pestaña **Cómo se obtuvo**. No se exporta `data/app.db` ni las fotografías usadas, por privacidad y porque son archivos de ejecución local. Estos resultados no garantizan que cada llamada futura a Gemini o Geoapify responda del mismo modo.

| Caso | Prueba | Resultado observado |
|---|---|---|
| #3 | Texto: llanta de bicicleta y taller cercano | Recomendación generada, consulta Geoapify y acción de guardado. La primera selección de BicirrUN era poco específica y posteriormente se corrigió. |
| #5 | Texto + imagen de llanta desinflada | `hallazgos_imagen.hay_imagen=true`; descripción coherente de rueda; recomendación y acción guardada. |
| #6 | Solicitud de ruta sin destino | Detectó información insuficiente y preguntó por el destino. |
| #7 | Solicitud de receta de cocina | `fuera_de_alcance`, no generó recomendación urbana. |
| #8 | Texto sobre automóvil + imagen de bicicleta | `contradictoria`, `coincide_con_texto=false`, solicitó aclaración. |
| #9 | Reparación de bicicleta y exclusión de estacionamiento/alquiler | Prefirió taller del catálogo **(demo)** frente a puntos BicirrUN; aclaró que se trataba de datos ficticios de prueba. |
| #10 | Farmacia cercana al Museo del Oro | Origen geocodificado con confianza 1.0, resultados reales de Geoapify, ruta caminando y acción guardada. |
| #12 | Origen Carrera 7 con Calle 45 | Geocodificación devolvió `null` y el sistema pidió una ubicación más precisa en vez de inventar coordenadas. |

## Verificaciones adicionales

- El chat recordó el contexto y mostró información no verificada como desconocida.
- `guardar_ruta_en_caso` devolvió `ok: true` y un `accion_id`.
- Después de reiniciar el servidor, el caso #3 y la acción #2 se seguían recuperando en la traza.
- Las API externas **requieren conexión a internet**. Hubo timeouts temporales durante las pruebas; por eso se configuraron plazos de espera más amplios para la demostración.

## Comprobación previa a la sustentación

1. Iniciar con `npm start` y verificar `http://localhost:3000/api/estado`.
2. Comprobar que Gemini y Geoapify respondan a un caso sencillo (no basta con que el estado de claves sea `true`).
3. Mostrar caso con imagen, caso insuficiente, contradicción, fuera de alcance, chat con acción, persistencia y trazabilidad.
4. Revisar el mapa, las fuentes y advertencias. Los servicios `(demo)` **no son establecimientos reales comprobados**.
5. Llevar internet móvil de respaldo y un video local de la aplicación funcionando en caso de caída del servicio.
