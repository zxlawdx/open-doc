from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/code', lambda params: workspace_view(params, 'code'), name='code', title='Código', layout='blank', show_in_sidebar=False)
