from shared.services.workspace_renderer import workspace_view
from vela.core.router import Router

def register_routes(router: Router) -> None:
    """Conecta a tela à navegação e ao lifecycle do shell Vela."""
    router.add(
        "/",
        workspace_view,
        title="Escrita",
        name="open_doc",
        layout="blank",
        show_in_sidebar=False,
    )
