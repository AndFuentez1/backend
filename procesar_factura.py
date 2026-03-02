#!/usr/bin/env python3
"""
Sistema de procesamiento de facturas electrónicas colombianas
Implementación Híbrida: Reglas (85%) + IA Gemini (15%)
Privacidad Mejorada + Costo Cero
"""

import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import json
import os
import hashlib
import unicodedata
import google.generativeai as genai
from supabase import create_client, Client

# Configuración desde variables de entorno
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

# Configurar Gemini con validación preventiva
genai_configured = False
if GOOGLE_API_KEY:
    # Validación simple de formato para evitar crashes
    if GOOGLE_API_KEY.startswith('GOCSPX') or GOOGLE_API_KEY.startswith('eyJ'):
        print("⚠️ PRECAUCIÓN: La Google API Key parece ser un Client Secret o Token de Supabase, no una API Key válida de AI.")
        print("   El sistema funcionará en modo SOLO REGLAS (85% efectividad) hasta que se corrija.")
    else:
        try:
            genai.configure(api_key=GOOGLE_API_KEY)
            genai_configured = True
        except Exception as e:
            print(f"⚠️ Error configurando Gemini: {e}")

# ... (resto del código)

class ProcesadorFacturaHibrido:
    """Procesador híbrido: Reglas (85%) + IA Gemini (15%)"""
    
    def __init__(self):
        self.model = None
        if genai_configured:
            try:
                self.model = genai.GenerativeModel('gemini-1.5-flash')
            except Exception as e:
                print(f"⚠️ No se pudo inicializar el modelo Gemini: {e}")
        
        self.supabase = None
        if SUPABASE_URL and SUPABASE_KEY:
            try:
                self.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            except Exception as e:
                print(f"❌ Error conectando a Supabase: {e}")

            
    def normalizar_texto(self, texto: str) -> str:
        """Normaliza texto removiendo tildes y convirtiendo a minúsculas"""
        if not texto: return ""
        try:
            texto = texto.lower()
            texto = unicodedata.normalize('NFD', texto)
            texto = ''.join(c for c in texto if unicodedata.category(c) != 'Mn')
            return texto
        except:
            return texto.lower()

    def clasificar_por_reglas(self, nombre_producto: str) -> Tuple[str, int, bool]:
        """
        Clasifica producto usando diccionario de palabras clave
        Returns: (categoria, certeza, necesita_ia)
        """
        nombre_norm = self.normalizar_texto(nombre_producto)
        
        for categoria, palabras_clave in REGLAS_CATEGORIAS.items():
            for palabra in palabras_clave:
                palabra_norm = self.normalizar_texto(palabra)
                # Verificar palabra completa o frase exacta
                if f" {palabra_norm} " in f" {nombre_norm} " or palabra_norm == nombre_norm:
                    return (categoria, 100, False)
                # Verificar subcadena si es palabra larga (>4 letras)
                if len(palabra_norm) > 4 and palabra_norm in nombre_norm:
                    return (categoria, 90, False)
        
        return ("Otros", 0, True)

    def categorizar_con_gemini(self, productos: List[Dict]) -> List[Dict]:
        """Usa Google Gemini para productos no reconocidos"""
        if not self.model:
            print("⚠️ Google API Key no configurada. Saltando categorización IA.")
            return productos
            
        try:
            prompt = f"""Eres un experto contable. Categoriza estos productos en una de estas categorías:
{json.dumps(list(REGLAS_CATEGORIAS.keys()), ensure_ascii=False)}

Productos a clasificar:
{json.dumps([p['nombre'] for p in productos], ensure_ascii=False)}

Responde SOLO con un JSON array de objetos. Cada objeto debe tener:
- "producto": nombre original
- "categoria": categoría asignada
- "confianza": número 1-100

Ejemplo:
[
  {{"producto": "Nombre Producto", "categoria": "Alimentación", "confianza": 95}}
]"""

            response = self.model.generate_content(prompt)
            texto_respuesta = response.text.strip()
            
            # Limpiar posible markdown
            if "```json" in texto_respuesta:
                texto_respuesta = texto_respuesta.split("```json")[1].split("```")[0]
            elif "```" in texto_respuesta:
                texto_respuesta = texto_respuesta.split("```")[1].split("```")[0]
                
            resultados = json.loads(texto_respuesta)
            
            # Crear mapa de resultados
            mapa_resultados = {r['producto']: r for r in resultados}
            
            for producto in productos:
                if producto['nombre'] in mapa_resultados:
                    res = mapa_resultados[producto['nombre']]
                    producto['categoria'] = res.get('categoria', 'Otros')
                    producto['certeza'] = res.get('confianza', 50)
                    producto['origen'] = 'IA Gemini'
                else:
                    producto['categoria'] = 'Otros'
                    producto['origen'] = 'IA Falló'
                    
            return productos
            
        except Exception as e:
            print(f"❌ Error en Gemini: {e}")
            return productos

    def procesar_lista_productos(self, productos: List[Dict]) -> List[Dict]:
        """Flujo principal de clasificación híbrida"""
        
        productos_finales = []
        para_ia = []
        
        print(f"🔄 Procesando {len(productos)} productos...")
        
        # PASO 1: Reglas
        for p in productos:
            cat, cert, ia = self.clasificar_por_reglas(p['nombre'])
            p['categoria'] = cat
            p['certeza'] = cert
            p['necesita_ia'] = ia
            p['origen'] = 'Reglas'
            
            if ia:
                para_ia.append(p)
            else:
                productos_finales.append(p)
                
        # PASO 2: IA (solo para los que fallaron reglas)
        if para_ia:
            print(f"🤖 Enviando {len(para_ia)} productos a Gemini...")
            procesados_ia = self.categorizar_con_gemini(para_ia)
            productos_finales.extend(procesados_ia)
            
        return productos_finales

    def extraer_xml(self, ruta_xml: str) -> Dict:
        """Extrae datos básicos del XML (UBL 2.1 Colombia)"""
        tree = ET.parse(ruta_xml)
        root = tree.getroot()
        
        # Namespaces
        ns = {
            'cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
            'cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
        }
        
        # Auto-detectar namespaces si fallan los estándar
        if not root.findall('.//cbc:IssueDate', ns):
            ns = {k: v for k, v in root.nsmap.items() if k} if hasattr(root, 'nsmap') else {}

        data = {
            'fecha': datetime.now().strftime('%Y-%m-%d'),
            'establecimiento': 'Desconocido',
            'total': 0,
            'productos': []
        }
        
        try:
            # Fecha
            fecha_node = root.find('.//cbc:IssueDate', ns)
            if fecha_node is not None:
                data['fecha'] = fecha_node.text
                
            # Establecimiento
            supplier = root.find('.//cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name', ns)
            if not supplier:
                supplier = root.find('.//cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName', ns)
            if supplier is not None:
                data['establecimiento'] = supplier.text
                
            # Total
            total_node = root.find('.//cac:LegalMonetaryTotal/cbc:PayableAmount', ns)
            if total_node is not None:
                data['total'] = float(total_node.text)
                
            # Productos
            lines = root.findall('.//cac:InvoiceLine', ns)
            for line in lines:
                desc = line.find('.//cbc:Description', ns)
                name = line.find('.//cac:Item/cbc:Name', ns)
                price = line.find('.//cbc:LineExtensionAmount', ns)
                
                nombre = (desc.text if desc is not None else (name.text if name is not None else "Sin Nombre"))
                valor = float(price.text) if price is not None else 0
                
                data['productos'].append({
                    'nombre': nombre,
                    'total': valor,
                    'cantidad': 1 # Simplificado
                })
                
        except Exception as e:
            print(f"Error parsing XML: {e}")
            
        return data

    def guardar_supabase(self, datos_factura: Dict, productos: List[Dict]):
        """Guarda en Supabase"""
        if not self.supabase:
            print("⚠️ Supabase no configurado. Saltando guardado.")
            return

        try:
            # Agrupar por categoría
            agrupados = {}
            for p in productos:
                cat = p['categoria']
                if cat not in agrupados:
                    agrupados[cat] = {'total': 0, 'items': []}
                agrupados[cat]['total'] += p['total']
                agrupados[cat]['items'].append(p['nombre'])
            
            # Insertar registros
            to_insert = []
            for cat, info in agrupados.items():
                to_insert.append({
                    'fecha': datos_factura['fecha'],
                    'establecimiento': datos_factura['establecimiento'],
                    'descripcion': ", ".join(info['items'][:5]),
                    'categoria': cat,
                    'valor': info['total'],
                    'metodo_pago': 'No especificado', # TODO: Extraer del XML si es crítico
                    'created_at': datetime.now().isoformat()
                })
                
            self.supabase.table('gastos').insert(to_insert).execute()
            print(f"✅ Guardados {len(to_insert)} registros en Supabase")
            
        except Exception as e:
            print(f"❌ Error guardando en Supabase: {e}")

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        proc = ProcesadorFacturaHibrido()
        data = proc.extraer_xml(sys.argv[1])
        prods = proc.procesar_lista_productos(data['productos'])
        proc.guardar_supabase(data, prods)
        
        print("\n📊 Resumen:")
        for p in prods:
            print(f"- {p['nombre']} -> {p['categoria']} ({p['origen']})")
