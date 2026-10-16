from typing import Any
from vela.core.router import Router
from vela.template_engine.engine import render_template
from apps.open_doc.services.preferences_service import PROJECT_ROOT


def workspace_view(params: dict[str, Any]) -> str:
    """Renderiza a composição usando exclusivamente o template engine Vela."""
    router = params["router"]
    context = {
        "sidebar": render_template(
            str(PROJECT_ROOT / "apps/open_doc/templates/sidebar.html"), router=router
        ),
        "editor": render_template(
            str(PROJECT_ROOT / "apps/open_doc/templates/editor.html"), router=router
        ),
    }
    for part in ("menus", "toolbar", "home"):
        context[part] = render_template(
            str(PROJECT_ROOT / f"apps/open_doc/templates/{part}.html"), router=router
        )
    return render_template(
        str(PROJECT_ROOT / "apps/open_doc/templates/base.html"),
        context=context,
        router=router,
    )


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
