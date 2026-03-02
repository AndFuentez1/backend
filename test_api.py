import requests
import base64
import os
import json

# URL de tu backend en Render
API_URL = "https://trackerfinanciero.onrender.com"
WEBHOOK_URL = f"{API_URL}/api/webhook/secure-token"
XML_FILE = "test_invoice.xml"

def test_api():
    print(f"🚀 Iniciando prueba de conexión con {API_URL}...")
    
    # 1. Health Check
    try:
        resp = requests.get(f"{API_URL}/health", timeout=10)
        if resp.status_code == 200:
            print("✅ Backend ONLINE (Health check OK)")
        else:
            print(f"❌ Backend respondió con error: {resp.status_code}")
            return
    except Exception as e:
        print(f"❌ No se pudo conectar al backend: {e}")
        return

    # 2. Leer XML de prueba
    if not os.path.exists(XML_FILE):
        print(f"❌ No se encontró el archivo de prueba {XML_FILE}")
        return
        
    with open(XML_FILE, "rb") as f:
        xml_content = f.read()
        xml_base64 = base64.b64encode(xml_content).decode('utf-8')

    # 3. Enviar a Webhook
    payload = {
        "xml_base64": xml_base64,
        "filename": XML_FILE
    }
    
    print("\n📤 Enviando factura de prueba...")
    try:
        resp = requests.post(WEBHOOK_URL, json=payload, timeout=30)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("success"):
            print("\n✅ PROCESAMIENTO EXITOSO")
            print("-" * 30)
            print(f"🏢 Establecimiento: {data['data']['establecimiento']}")
            print(f"💰 Total: ${data['data']['total']}")
            print(f"📦 Productos procesados: {data['data']['productos_procesados']}")
            print("-" * 30)
            print("👉 Verifica ahora tu tabla 'gastos' en Supabase.")
        else:
            print(f"\n❌ Error en procesamiento: {resp.text}")
            
    except Exception as e:
        print(f"\n❌ Error enviando solicitud: {e}")

if __name__ == "__main__":
    test_api()
