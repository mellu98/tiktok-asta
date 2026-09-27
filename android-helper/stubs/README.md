Stub di compilazione: SOLO le firme delle API Android usate da `UiDump`.
Servono a `javac` e **non** finiscono nel jar (a runtime le classi vere
arrivano dal sistema: framework Android + `/system/framework/uiautomator.jar`).
Così la build non richiede l'intero Android SDK (`android.jar`).
