from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
from procesar_factura import ProcesadorFacturaHibrido

app = Flask(__name__)
CORS(app)

procesador = ProcesadorFacturaHibrido()

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "service": "invoice-processor-hybrid"}), 200

@app.route('/api/webhook/<token>', methods=['POST'])
def webhook(token):
    # Aquí podrías validar el token contra una DB si fuera multi-usuario real
    # Por ahora es simple para uso personal
    
    if 'xml_content' not in request.json and 'xml_base64' not in request.json:
        return jsonify({"error": "No XML content provided"}), 400

    try:
        # Guardar XML temporalmente
        with tempfile.NamedTemporaryFile(delete=False, suffix='.xml') as tmp:
            if 'xml_base64' in request.json:
                import base64
                content = base64.b64decode(request.json['xml_base64'])
                tmp.write(content)
            else:
                tmp.write(request.json['xml_content'].encode('utf-8'))
            tmp_path = tmp.name

        # Procesar
        datos = procesador.extraer_xml(tmp_path)
        productos_finales = procesador.procesar_lista_productos(datos['productos'])
        procesador.guardar_supabase(datos, productos_finales)

        # Limpiar
        os.unlink(tmp_path)

        return jsonify({
            "success": True,
            "data": {
                "establecimiento": datos['establecimiento'],
                "total": datos['total'],
                "productos_procesados": len(productos_finales)
            }
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
